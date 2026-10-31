// Concept2 Logbook API — https://log.concept2.com/developers/documentation/
// RowErg, SkiErg and BikeErg results.
import { dayWithOffset, zonedToUtc } from "../time";
import { fetchJson, tokenRequest, toTokenSet } from "./oauth";
import type { ProviderAdapter } from "./types";

const BASE = "https://log.concept2.com";
const ACCEPT = { Accept: "application/vnd.c2logbook.v1+json" };
const SPORT: Record<string, string> = { rower: "Rowing", skierg: "Ski erg", bike: "Indoor cycling", dynamic: "Rowing", slides: "Rowing" };
const LABEL: Record<string, string> = { rower: "RowErg", skierg: "SkiErg", bike: "BikeErg", dynamic: "Dynamic RowErg", slides: "RowErg on Slides" };

type Result = {
  id: number;
  user_id: number;
  type: string;
  date: string; // "2026-10-01 07:00:00", wall-clock in `timezone`
  timezone?: string | null;
  distance: number; // metres
  time: number; // tenths of a second
  calories_total?: number;
  stroke_rate?: number;
  heart_rate?: { average?: number; max?: number };
  workout_type?: string;
};

export function mapConcept2Result(r: Result, fallbackTz: string) {
  const start = zonedToUtc(r.date, r.timezone || fallbackTz);
  const seconds = r.time / 10;
  return {
    externalId: String(r.id),
    name: `Concept2 ${LABEL[r.type] ?? r.type}${r.workout_type ? ` · ${r.workout_type}` : ""}`,
    sportRaw: SPORT[r.type] ?? r.type,
    startTime: start,
    endTime: new Date(start.getTime() + seconds * 1000),
    elapsedSeconds: seconds,
    movingSeconds: seconds,
    distanceM: r.distance,
    avgHr: r.heart_rate?.average,
    maxHr: r.heart_rate?.max,
    avgCadence: r.stroke_rate,
    avgSpeed: seconds ? r.distance / seconds : null,
    calories: r.calories_total,
  };
}

export const concept2: ProviderAdapter = {
  id: "concept2",
  envPrefix: "CONCEPT2",
  authorize: { url: `${BASE}/oauth/authorize`, scopes: ["user:read", "results:read"], scopeSeparator: "," },

  async exchangeCode(code, redirectUri, creds) {
    const token = toTokenSet(await tokenRequest(`${BASE}/oauth/access_token`, { grant_type: "authorization_code", code, redirect_uri: redirectUri, scope: "user:read,results:read" }, creds));
    const me = await fetchJson<{ data: { id: number; username?: string } }>(`${BASE}/api/users/me`, { headers: { ...ACCEPT, Authorization: `Bearer ${token.accessToken}` } });
    return { ...token, externalUserId: String(me.data.id), displayName: me.data.username ?? null };
  },

  async refresh(refreshToken, creds) {
    return toTokenSet(await tokenRequest(`${BASE}/oauth/access_token`, { grant_type: "refresh_token", refresh_token: refreshToken, scope: "user:read,results:read" }, creds));
  },

  async sync(ctx) {
    let url: string | null = `${BASE}/api/users/me/results?from=${dayWithOffset(ctx.since, 0)}&number=250`;
    while (url) {
      const page: { data: Result[]; meta?: { pagination?: { links?: { next?: string } } } } = await ctx.api(url, { headers: ACCEPT });
      for (const r of page.data ?? []) {
        await ctx.ingest.activity({ ...mapConcept2Result(r, ctx.timezone), device: { brand: "Concept2", model: LABEL[r.type] ?? r.type, kind: "trainer" }, rawRecordId: await ctx.ingest.raw("result", r.id, r) });
      }
      url = page.meta?.pagination?.links?.next ?? null;
    }
  },

  webhook: {
    urlKey: true,
    // Unsigned; only triggers a re-fetch with the user's own token.
    parse(_req, body) {
      const evt = JSON.parse(body) as { data?: { result?: { user_id?: number }; user_id?: number } };
      const uid = evt.data?.result?.user_id ?? evt.data?.user_id;
      return { externalUserId: uid != null ? String(uid) : null, sinceHours: 72 };
    },
  },
};
