// WHOOP Developer API v2 — https://developer.whoop.com
import { hmac, safeEqual } from "../crypto";
import { dayWithOffset, parseOffset } from "../time";
import { tokenRequest, toTokenSet, fetchJson } from "./oauth";
import type { ProviderAdapter, SyncContext } from "./types";

const API = "https://api.prod.whoop.com/developer";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const DEVICE = { brand: "WHOOP", model: "WHOOP", kind: "band" };

type Page<T> = { records: T[]; next_token?: string | null };

type Cycle = {
  id: number;
  start: string;
  end?: string | null;
  timezone_offset: string;
  score_state: string;
  score?: { strain: number; kilojoule: number; average_heart_rate: number; max_heart_rate: number };
};
type Recovery = {
  cycle_id: number;
  sleep_id: string;
  created_at: string;
  score_state: string;
  score?: { recovery_score: number; resting_heart_rate: number; hrv_rmssd_milli: number; spo2_percentage?: number; skin_temp_celsius?: number };
};
type Sleep = {
  id: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: string;
  score?: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
    };
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_efficiency_percentage?: number;
  };
};
type Workout = {
  id: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_name?: string;
  score_state: string;
  score?: { strain: number; average_heart_rate: number; max_heart_rate: number; kilojoule: number; distance_meter?: number; altitude_gain_meter?: number };
};

async function* pages<T>(ctx: SyncContext, path: string): AsyncGenerator<T> {
  let next: string | null | undefined;
  do {
    const qs = new URLSearchParams({ limit: "25", start: ctx.since.toISOString() });
    if (next) qs.set("nextToken", next);
    const page = await ctx.api<Page<T>>(`${API}${path}?${qs}`);
    for (const r of page.records) yield r;
    next = page.next_token;
  } while (next);
}

const ms2s = (v: number | undefined) => (v == null ? null : v / 1000);

export const whoop: ProviderAdapter = {
  id: "whoop",
  envPrefix: "WHOOP",
  authorize: {
    url: "https://api.prod.whoop.com/oauth/oauth2/auth",
    scopes: ["offline", "read:recovery", "read:cycles", "read:workout", "read:sleep", "read:profile", "read:body_measurement"],
    scopeSeparator: " ",
  },

  async exchangeCode(code, redirectUri, creds) {
    const t = await tokenRequest(TOKEN_URL, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, creds);
    const token = toTokenSet(t);
    const profile = await fetchJson<{ user_id: number; first_name: string; last_name: string }>(`${API}/v2/user/profile/basic`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    return { ...token, externalUserId: String(profile.user_id), displayName: `${profile.first_name} ${profile.last_name}`.trim() };
  },

  async refresh(refreshToken, creds) {
    return toTokenSet(await tokenRequest(TOKEN_URL, { grant_type: "refresh_token", refresh_token: refreshToken, scope: "offline" }, creds));
  },

  async sync(ctx) {
    const { ingest } = ctx;

    // Cycles first: recoveries reference them for their calendar day.
    const cycleDay = new Map<number, { day: string; start: Date }>();
    for await (const c of pages<Cycle>(ctx, "/v2/cycle")) {
      const offset = parseOffset(c.timezone_offset) ?? 0;
      const start = new Date(c.start);
      const day = dayWithOffset(start, offset);
      cycleDay.set(c.id, { day, start });
      if (c.score_state !== "SCORED" || !c.score) continue;
      const rawRecordId = await ingest.raw("cycle", c.id, c);
      const base = { granularity: "daily" as const, day, startTime: start, endTime: c.end ? new Date(c.end) : null, device: DEVICE, rawRecordId };
      await ingest.observation({ ...base, metric: "strain", value: c.score.strain, externalId: `cycle:${c.id}:strain` });
      await ingest.observation({ ...base, metric: "total_energy", value: c.score.kilojoule / 4.184, externalId: `cycle:${c.id}:energy` });
    }

    for await (const r of pages<Recovery>(ctx, "/v2/recovery")) {
      if (r.score_state !== "SCORED" || !r.score) continue;
      const cycle = cycleDay.get(r.cycle_id);
      const day = cycle?.day ?? r.created_at.slice(0, 10);
      const rawRecordId = await ingest.raw("recovery", r.cycle_id, r);
      const base = { granularity: "daily" as const, day, startTime: cycle?.start ?? new Date(r.created_at), device: DEVICE, rawRecordId };
      const id = `recovery:${r.cycle_id}`;
      await ingest.observation({ ...base, metric: "recovery_score", value: r.score.recovery_score, externalId: `${id}:score` });
      await ingest.observation({ ...base, metric: "resting_hr", value: r.score.resting_heart_rate, externalId: `${id}:rhr` });
      await ingest.observation({ ...base, metric: "hrv_rmssd", value: r.score.hrv_rmssd_milli, externalId: `${id}:hrv` });
      await ingest.observation({ ...base, metric: "spo2", value: r.score.spo2_percentage, externalId: `${id}:spo2` });
      await ingest.observation({ ...base, metric: "skin_temp", value: r.score.skin_temp_celsius, externalId: `${id}:skin_temp` });
    }

    for await (const s of pages<Sleep>(ctx, "/v2/activity/sleep")) {
      if (s.nap || s.score_state !== "SCORED" || !s.score) continue;
      const end = new Date(s.end);
      const day = dayWithOffset(end, parseOffset(s.timezone_offset) ?? 0); // sleep belongs to the wake-up day
      const rawRecordId = await ingest.raw("sleep", s.id, s);
      const st = s.score.stage_summary;
      const asleep = st.total_light_sleep_time_milli + st.total_slow_wave_sleep_time_milli + st.total_rem_sleep_time_milli;
      const base = { granularity: "session" as const, day, startTime: new Date(s.start), endTime: end, device: DEVICE, rawRecordId };
      const id = `sleep:${s.id}`;
      await ingest.observation({ ...base, metric: "sleep_duration", value: ms2s(asleep), externalId: `${id}:total` });
      await ingest.observation({ ...base, metric: "sleep_deep", value: ms2s(st.total_slow_wave_sleep_time_milli), externalId: `${id}:deep` });
      await ingest.observation({ ...base, metric: "sleep_rem", value: ms2s(st.total_rem_sleep_time_milli), externalId: `${id}:rem` });
      await ingest.observation({ ...base, metric: "sleep_light", value: ms2s(st.total_light_sleep_time_milli), externalId: `${id}:light` });
      await ingest.observation({ ...base, metric: "sleep_awake", value: ms2s(st.total_awake_time_milli), externalId: `${id}:awake` });
      await ingest.observation({ ...base, metric: "sleep_efficiency", value: s.score.sleep_efficiency_percentage, externalId: `${id}:eff` });
      await ingest.observation({ ...base, metric: "sleep_score", value: s.score.sleep_performance_percentage, externalId: `${id}:perf` });
      await ingest.observation({ ...base, metric: "respiratory_rate", value: s.score.respiratory_rate, externalId: `${id}:rr` });
    }

    for await (const w of pages<Workout>(ctx, "/v2/activity/workout")) {
      if (w.score_state !== "SCORED" || !w.score) continue;
      const start = new Date(w.start);
      const end = new Date(w.end);
      await ingest.activity({
        externalId: w.id,
        name: w.sport_name ? `WHOOP ${w.sport_name}` : "WHOOP workout",
        sportRaw: w.sport_name ?? null,
        startTime: start,
        endTime: end,
        utcOffsetMinutes: parseOffset(w.timezone_offset),
        elapsedSeconds: (end.getTime() - start.getTime()) / 1000,
        distanceM: w.score.distance_meter,
        elevationGainM: w.score.altitude_gain_meter,
        avgHr: w.score.average_heart_rate,
        maxHr: w.score.max_heart_rate,
        calories: w.score.kilojoule / 4.184,
        strain: w.score.strain,
        device: DEVICE,
        rawRecordId: await ingest.raw("workout", w.id, w),
      });
    }

    try {
      const body = await ctx.api<{ height_meter: number; weight_kilogram: number; max_heart_rate: number }>(`${API}/v2/user/measurement/body`);
      const day = dayWithOffset(new Date(), 0);
      await ingest.observation({
        metric: "weight",
        value: body.weight_kilogram,
        granularity: "daily",
        day,
        externalId: `body:${day}:weight`,
        rawRecordId: await ingest.raw("body_measurement", day, body),
      });
    } catch (e) {
      ctx.log(`body measurement skipped: ${(e as Error).message}`);
    }
  },

  async revoke(token) {
    await fetch(`${API}/v2/user/access`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  },

  webhook: {
    // Signature: base64(HMAC-SHA256(timestamp + rawBody, client_secret))
    parse(req, body, creds) {
      const sig = req.headers.get("x-whoop-signature");
      const ts = req.headers.get("x-whoop-signature-timestamp");
      if (!sig || !ts || !safeEqual(sig, hmac("sha256", creds.clientSecret, ts + body, "base64"))) return null;
      const evt = JSON.parse(body) as { user_id: number; type: string };
      return { externalUserId: String(evt.user_id), sinceHours: 72 };
    },
  },
};
