// Oura API v2 — https://cloud.ouraring.com/v2/docs
import { addDays, dayWithOffset } from "../time";
import { fetchJson, tokenRequest, toTokenSet } from "./oauth";
import type { ProviderAdapter, SyncContext } from "./types";

const API = "https://api.ouraring.com/v2/usercollection";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";
const DEVICE = { brand: "Oura", model: "Oura Ring", kind: "ring" };

async function* collection<T>(ctx: SyncContext, name: string, params: Record<string, string>): AsyncGenerator<T> {
  let next: string | null = null;
  do {
    const qs = new URLSearchParams(params);
    if (next) qs.set("next_token", next);
    const page: { data: T[]; next_token: string | null } = await ctx.api(`${API}/${name}?${qs}`);
    for (const r of page.data) yield r;
    next = page.next_token;
  } while (next);
}

export const oura: ProviderAdapter = {
  id: "oura",
  envPrefix: "OURA",
  authorize: {
    url: "https://cloud.ouraring.com/oauth/authorize",
    scopes: ["email", "personal", "daily", "heartrate", "workout", "spo2", "session"],
    scopeSeparator: " ",
  },

  async exchangeCode(code, redirectUri, creds) {
    const token = toTokenSet(await tokenRequest(TOKEN_URL, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, creds));
    const info = await fetchJson<{ id: string; email?: string }>(`${API}/personal_info`, { headers: { Authorization: `Bearer ${token.accessToken}` } });
    return { ...token, externalUserId: info.id, displayName: info.email ?? null };
  },

  async refresh(refreshToken, creds) {
    return toTokenSet(await tokenRequest(TOKEN_URL, { grant_type: "refresh_token", refresh_token: refreshToken }, creds));
  },

  async sync(ctx) {
    const { ingest } = ctx;
    const range = { start_date: dayWithOffset(ctx.since, 0), end_date: addDays(dayWithOffset(new Date(), 0), 1) };

    for await (const r of collection<{ id: string; day: string; score: number | null; temperature_deviation: number | null }>(ctx, "daily_readiness", range)) {
      const rawRecordId = await ingest.raw("daily_readiness", r.id, r);
      const base = { granularity: "daily" as const, day: r.day, device: DEVICE, rawRecordId };
      await ingest.observation({ ...base, metric: "readiness_score", value: r.score, externalId: `readiness:${r.id}:score` });
      await ingest.observation({ ...base, metric: "temp_deviation", value: r.temperature_deviation, externalId: `readiness:${r.id}:temp` });
    }

    for await (const r of collection<{ id: string; day: string; score: number | null }>(ctx, "daily_sleep", range)) {
      await ingest.observation({
        metric: "sleep_score",
        value: r.score,
        granularity: "daily",
        day: r.day,
        device: DEVICE,
        externalId: `daily_sleep:${r.id}`,
        rawRecordId: await ingest.raw("daily_sleep", r.id, r),
      });
    }

    type Sleep = {
      id: string;
      day: string;
      type: string;
      bedtime_start: string;
      bedtime_end: string;
      total_sleep_duration: number | null;
      deep_sleep_duration: number | null;
      rem_sleep_duration: number | null;
      light_sleep_duration: number | null;
      awake_time: number | null;
      efficiency: number | null;
      average_hrv: number | null;
      lowest_heart_rate: number | null;
      average_breath: number | null;
    };
    for await (const s of collection<Sleep>(ctx, "sleep", range)) {
      if (s.type !== "long_sleep" && s.type !== "sleep") continue;
      const rawRecordId = await ingest.raw("sleep", s.id, s);
      const base = { granularity: "session" as const, day: s.day, startTime: new Date(s.bedtime_start), endTime: new Date(s.bedtime_end), device: DEVICE, rawRecordId };
      const id = `sleep:${s.id}`;
      await ingest.observation({ ...base, metric: "sleep_duration", value: s.total_sleep_duration, externalId: `${id}:total` });
      await ingest.observation({ ...base, metric: "sleep_deep", value: s.deep_sleep_duration, externalId: `${id}:deep` });
      await ingest.observation({ ...base, metric: "sleep_rem", value: s.rem_sleep_duration, externalId: `${id}:rem` });
      await ingest.observation({ ...base, metric: "sleep_light", value: s.light_sleep_duration, externalId: `${id}:light` });
      await ingest.observation({ ...base, metric: "sleep_awake", value: s.awake_time, externalId: `${id}:awake` });
      await ingest.observation({ ...base, metric: "sleep_efficiency", value: s.efficiency, externalId: `${id}:eff` });
      await ingest.observation({ ...base, metric: "hrv_rmssd", value: s.average_hrv, externalId: `${id}:hrv` });
      await ingest.observation({ ...base, metric: "resting_hr", value: s.lowest_heart_rate, externalId: `${id}:rhr` });
      await ingest.observation({ ...base, metric: "respiratory_rate", value: s.average_breath, externalId: `${id}:rr` });
    }

    type Act = { id: string; day: string; steps: number | null; active_calories: number | null; total_calories: number | null };
    for await (const a of collection<Act>(ctx, "daily_activity", range)) {
      const rawRecordId = await ingest.raw("daily_activity", a.id, a);
      const base = { granularity: "daily" as const, day: a.day, device: DEVICE, rawRecordId };
      await ingest.observation({ ...base, metric: "steps", value: a.steps, externalId: `activity:${a.id}:steps` });
      await ingest.observation({ ...base, metric: "active_energy", value: a.active_calories, externalId: `activity:${a.id}:active` });
      await ingest.observation({ ...base, metric: "total_energy", value: a.total_calories, externalId: `activity:${a.id}:total` });
    }

    for await (const s of collection<{ id: string; day: string; spo2_percentage: { average: number } | null }>(ctx, "daily_spo2", range)) {
      await ingest.observation({
        metric: "spo2",
        value: s.spo2_percentage?.average,
        granularity: "daily",
        day: s.day,
        device: DEVICE,
        externalId: `spo2:${s.id}`,
        rawRecordId: await ingest.raw("daily_spo2", s.id, s),
      });
    }

    type Workout = { id: string; activity: string; calories: number | null; distance: number | null; start_datetime: string; end_datetime: string; source: string };
    for await (const w of collection<Workout>(ctx, "workout", range)) {
      await ingest.activity({
        externalId: w.id,
        name: `Oura ${w.activity}`,
        sportRaw: w.activity,
        startTime: new Date(w.start_datetime),
        endTime: new Date(w.end_datetime),
        elapsedSeconds: (Date.parse(w.end_datetime) - Date.parse(w.start_datetime)) / 1000,
        distanceM: w.distance,
        calories: w.calories,
        origin: w.source !== "manual" ? null : "manual",
        device: DEVICE,
        rawRecordId: await ingest.raw("workout", w.id, w),
      });
    }
  },

  webhook: {
    urlKey: true,
    handshake(req) {
      const url = new URL(req.url);
      const challenge = url.searchParams.get("challenge");
      if (!challenge) return null;
      if (url.searchParams.get("verification_token") !== process.env.OURA_WEBHOOK_VERIFY_TOKEN) return new Response("forbidden", { status: 403 });
      return Response.json({ challenge });
    },
    parse(_req, body) {
      // Events only trigger a re-fetch with the user's own token.
      const evt = JSON.parse(body) as { user_id?: string };
      return { externalUserId: evt.user_id ?? null, sinceHours: 72 };
    },
  },
};
