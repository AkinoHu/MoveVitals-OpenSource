// Polar AccessLink API v3 — https://www.polar.com/accesslink-api/
// Covers Polar watches and any session recorded in Polar Flow with an H10.
import { hmac, safeEqual } from "../crypto";
import { dayWithOffset, isoDurationSeconds } from "../time";
import { fetchJson, redact, tokenRequest } from "./oauth";
import { ProviderError, type ProviderAdapter } from "./types";

const API = "https://www.polaraccesslink.com/v3";

type Exercise = {
  id: string;
  device?: string;
  start_time: string; // local time without offset
  start_time_utc_offset?: number; // minutes
  duration: string; // ISO-8601
  calories?: number;
  distance?: number;
  heart_rate?: { average?: number; maximum?: number };
  training_load?: number;
  sport?: string;
  detailed_sport_info?: string;
};
type Night = {
  date: string;
  sleep_start_time: string;
  sleep_end_time: string;
  light_sleep: number;
  deep_sleep: number;
  rem_sleep: number;
  total_interruption_duration: number;
  sleep_score?: number;
};
type Recharge = { date: string; heart_rate_avg?: number; heart_rate_variability_avg?: number; breathing_rate_avg?: number; ans_charge?: number };
type DailyActivity = { start_time: string; steps?: number; calories?: number; active_calories?: number };

export const polar: ProviderAdapter = {
  id: "polar",
  envPrefix: "POLAR",
  authorize: {
    url: "https://flow.polar.com/oauth2/authorization",
    scopes: ["accesslink.read_all"],
  },

  async exchangeCode(code, redirectUri, creds) {
    const t = await tokenRequest(
      "https://polarremote.com/v2/oauth2/token",
      { grant_type: "authorization_code", code, redirect_uri: redirectUri },
      creds,
      "basic",
    );
    // Polar tokens do not expire unless revoked and come without refresh token.
    return { accessToken: t.access_token, externalUserId: String(t.x_user_id), expiresAt: null };
  },

  // A user must be registered with our client before data is available.
  async afterConnect(token, _creds, { userId }) {
    const res = await fetch(`${API}/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ "member-id": userId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 409) throw new ProviderError(`Polar user registration failed: ${res.status} ${redact(await res.text())}`, res.status);
    if (res.status === 409) return {};
    const u = (await res.json()) as { "first-name"?: string; "last-name"?: string };
    return { displayName: `${u["first-name"] ?? ""} ${u["last-name"] ?? ""}`.trim() || null };
  },

  async sync(ctx) {
    const { ingest } = ctx;

    // Exercises from the last 30 days (AccessLink's window).
    const exercises = await ctx.api<Exercise[]>(`${API}/exercises`);
    for (const e of exercises ?? []) {
      const offset = e.start_time_utc_offset ?? 0;
      const start = new Date(new Date(`${e.start_time}Z`).getTime() - offset * 60_000);
      const seconds = isoDurationSeconds(e.duration) ?? 0;
      await ingest.activity({
        externalId: e.id,
        name: `Polar ${e.detailed_sport_info ?? e.sport ?? ""}`.trim(),
        sportRaw: e.detailed_sport_info ?? e.sport ?? null,
        startTime: start,
        endTime: new Date(start.getTime() + seconds * 1000),
        utcOffsetMinutes: offset,
        elapsedSeconds: seconds,
        distanceM: e.distance,
        avgHr: e.heart_rate?.average,
        maxHr: e.heart_rate?.maximum,
        calories: e.calories,
        trainingLoad: e.training_load,
        device: e.device ? { brand: "Polar", model: e.device, kind: "watch" } : null,
        rawRecordId: await ingest.raw("exercise", e.id, e),
      });
    }

    const sinceDay = dayWithOffset(ctx.since, 0);

    const sleep = await ctx.api<{ nights: Night[] }>(`${API}/users/sleep`);
    for (const n of sleep?.nights ?? []) {
      if (n.date < sinceDay) continue;
      const rawRecordId = await ingest.raw("sleep", n.date, n);
      const base = { granularity: "session" as const, day: n.date, startTime: new Date(n.sleep_start_time), endTime: new Date(n.sleep_end_time), rawRecordId };
      const id = `sleep:${n.date}`;
      await ingest.observation({ ...base, metric: "sleep_duration", value: n.light_sleep + n.deep_sleep + n.rem_sleep, externalId: `${id}:total` });
      await ingest.observation({ ...base, metric: "sleep_deep", value: n.deep_sleep, externalId: `${id}:deep` });
      await ingest.observation({ ...base, metric: "sleep_rem", value: n.rem_sleep, externalId: `${id}:rem` });
      await ingest.observation({ ...base, metric: "sleep_light", value: n.light_sleep, externalId: `${id}:light` });
      await ingest.observation({ ...base, metric: "sleep_awake", value: n.total_interruption_duration, externalId: `${id}:awake` });
      await ingest.observation({ ...base, metric: "sleep_score", value: n.sleep_score, externalId: `${id}:score` });
    }

    const recharge = await ctx.api<{ recharges: Recharge[] }>(`${API}/users/nightly-recharge`);
    for (const r of recharge?.recharges ?? []) {
      if (r.date < sinceDay) continue;
      const rawRecordId = await ingest.raw("nightly_recharge", r.date, r);
      const base = { granularity: "daily" as const, day: r.date, rawRecordId };
      const id = `recharge:${r.date}`;
      await ingest.observation({ ...base, metric: "hrv_rmssd", value: r.heart_rate_variability_avg, externalId: `${id}:hrv` });
      await ingest.observation({ ...base, metric: "resting_hr", value: r.heart_rate_avg, externalId: `${id}:hr` });
      await ingest.observation({ ...base, metric: "respiratory_rate", value: r.breathing_rate_avg, externalId: `${id}:rr` });
    }

    try {
      const daily = await ctx.api<DailyActivity[]>(`${API}/users/activities?from=${sinceDay}`);
      for (const a of daily ?? []) {
        const day = a.start_time.slice(0, 10);
        const rawRecordId = await ingest.raw("daily_activity", day, a);
        const base = { granularity: "daily" as const, day, rawRecordId };
        await ingest.observation({ ...base, metric: "steps", value: a.steps, externalId: `activity:${day}:steps` });
        await ingest.observation({ ...base, metric: "active_energy", value: a.active_calories, externalId: `activity:${day}:active` });
        await ingest.observation({ ...base, metric: "total_energy", value: a.calories, externalId: `activity:${day}:total` });
      }
    } catch (e) {
      ctx.log(`daily activity skipped: ${(e as Error).message}`);
    }
  },

  async revoke(token, _creds, connection) {
    if (!connection.externalUserId) return;
    await fetchJson(`${API}/users/${connection.externalUserId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  },

  webhook: {
    // Polar-Webhook-Signature: hex HMAC-SHA256 of the body with the secret
    // returned when the webhook was created (POLAR_WEBHOOK_SECRET).
    parse(req, body) {
      const evt = JSON.parse(body) as { event: string; user_id?: number };
      // Polar pings the URL while the webhook is being created, before we
      // know the signing secret. A ping carries no data and triggers nothing.
      if (evt.event === "PING") return { externalUserId: null };
      const secret = process.env.POLAR_WEBHOOK_SECRET;
      const sig = req.headers.get("polar-webhook-signature");
      if (!secret || !sig || !safeEqual(sig, hmac("sha256", secret, body, "hex"))) return null;
      return { externalUserId: evt.user_id != null ? String(evt.user_id) : null, sinceHours: 72 };
    },
  },
};
