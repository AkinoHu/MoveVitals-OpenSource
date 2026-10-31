// Strava API v3 — https://developers.strava.com
//
// Strava is mostly a relay: Zwift, COROS, Garmin… upload to it. We record the
// original recorder in `origin` so conflict resolution and the UI can tell a
// Zwift ride apart from a watch ride. Strava data is flagged `aiRestricted`
// in the catalogue because the Strava API Agreement limits AI use.
import { tokenRequest, toTokenSet } from "./oauth";
import type { ProviderAdapter } from "./types";

const API = "https://www.strava.com/api/v3";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const STREAMS_PER_SYNC = 25;
const STREAM_KEYS = ["time", "heartrate", "watts", "cadence", "velocity_smooth", "altitude", "distance", "latlng"];

type Activity = {
  id: number;
  name: string;
  sport_type: string;
  type: string;
  start_date: string;
  utc_offset: number;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  device_watts?: boolean;
  average_cadence?: number;
  average_speed?: number;
  kilojoules?: number;
  calories?: number;
  suffer_score?: number;
  external_id?: string | null;
  device_name?: string | null;
  trainer?: boolean;
};

// Infer the original recorder from Strava's upload metadata.
export function stravaOrigin(a: Pick<Activity, "external_id" | "device_name" | "trainer">): string | null {
  const ext = (a.external_id ?? "").toLowerCase();
  const dev = a.device_name ?? "";
  if (/zwift/i.test(ext) || /zwift/i.test(dev)) return "Zwift";
  if (/^garmin|garmin/i.test(ext) || /garmin/i.test(dev)) return dev || "Garmin";
  if (/coros/i.test(ext) || /coros/i.test(dev)) return dev || "COROS";
  if (/polar/i.test(dev)) return dev;
  if (/wahoo|elemnt/i.test(dev)) return dev;
  if (/apple watch|watchos/i.test(dev)) return dev;
  if (/mywhoosh/i.test(ext + dev)) return "MyWhoosh";
  if (/rouvy/i.test(ext + dev)) return "Rouvy";
  return dev || null;
}

export const strava: ProviderAdapter = {
  id: "strava",
  envPrefix: "STRAVA",
  authorize: {
    url: "https://www.strava.com/oauth/authorize",
    scopes: ["read", "activity:read_all", "profile:read_all"],
    scopeSeparator: ",",
    params: { approval_prompt: "auto" },
  },

  async exchangeCode(code, _redirectUri, creds) {
    const t = await tokenRequest(TOKEN_URL, { grant_type: "authorization_code", code }, creds);
    const athlete = t.athlete as { id: number; firstname?: string; lastname?: string } | undefined;
    return {
      ...toTokenSet(t),
      externalUserId: athlete ? String(athlete.id) : null,
      displayName: athlete ? `${athlete.firstname ?? ""} ${athlete.lastname ?? ""}`.trim() : null,
    };
  },

  async refresh(refreshToken, creds) {
    return toTokenSet(await tokenRequest(TOKEN_URL, { grant_type: "refresh_token", refresh_token: refreshToken }, creds));
  },

  async sync(ctx) {
    const { ingest } = ctx;
    const after = Math.floor(ctx.since.getTime() / 1000);
    let streamBudget = STREAMS_PER_SYNC;

    for (let page = 1; ; page++) {
      const list = await ctx.api<Activity[]>(`${API}/athlete/activities?after=${after}&per_page=100&page=${page}`);
      for (const a of list) {
        const start = new Date(a.start_date);
        const origin = stravaOrigin(a);
        const id = await ingest.activity({
          externalId: String(a.id),
          name: a.name,
          sportRaw: a.trainer && /ride/i.test(a.sport_type) ? "VirtualRide" : a.sport_type || a.type,
          startTime: start,
          endTime: new Date(start.getTime() + a.elapsed_time * 1000),
          utcOffsetMinutes: Math.round(a.utc_offset / 60),
          movingSeconds: a.moving_time,
          elapsedSeconds: a.elapsed_time,
          distanceM: a.distance || null,
          elevationGainM: a.total_elevation_gain,
          avgHr: a.average_heartrate,
          maxHr: a.max_heartrate,
          avgPower: a.average_watts,
          normalizedPower: a.weighted_average_watts,
          avgCadence: a.average_cadence,
          avgSpeed: a.average_speed,
          calories: a.calories ?? (a.kilojoules ? a.kilojoules : null), // cycling: kJ ≈ kcal burned
          trainingLoad: a.suffer_score,
          origin,
          device: a.device_name ? { model: a.device_name, kind: "app" } : null,
          rawRecordId: await ingest.raw("activity", a.id, a),
        });

        if (streamBudget > 0 && !(await ingest.hasStreams(String(a.id)))) {
          streamBudget--;
          try {
            const s = await ctx.api<Record<string, { data: number[] }>>(
              `${API}/activities/${a.id}/streams?keys=${STREAM_KEYS.join(",")}&key_by_type=true`,
            );
            await ingest.streams(id, Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.data])));
          } catch (e) {
            ctx.log(`streams ${a.id}: ${(e as Error).message}`);
          }
        }
      }
      if (list.length < 100) break;
    }
  },

  async revoke(token) {
    await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  },

  webhook: {
    urlKey: true,
    handshake(req) {
      const url = new URL(req.url);
      if (url.searchParams.get("hub.mode") !== "subscribe") return null;
      if (url.searchParams.get("hub.verify_token") !== process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) return new Response("forbidden", { status: 403 });
      return Response.json({ "hub.challenge": url.searchParams.get("hub.challenge") });
    },
    parse(_req, body) {
      // Strava does not sign deliveries; the secret URL key authenticates them.
      // Events only trigger a re-fetch with the user's own token, and a
      // deauthorisation is verified against the API before it is acted on.
      const evt = JSON.parse(body) as { object_type: string; owner_id: number; aspect_type: string; updates?: Record<string, string> };
      if (evt.object_type === "athlete" && evt.updates?.authorized === "false") return { externalUserId: String(evt.owner_id), sinceHours: 0 };
      return { externalUserId: String(evt.owner_id), sinceHours: 48 };
    },
  },
};
