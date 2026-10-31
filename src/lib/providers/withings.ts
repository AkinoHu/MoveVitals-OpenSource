// Withings Public Health Data API — https://developer.withings.com
// Every response is wrapped as { status, body }; status 0 means success.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { connections } from "../db/schema";
import { webhookUrl } from "../webhook-key";
import { addDays, dayInTz, dayWithOffset } from "../time";
import { ProviderError, type Credentials, type ProviderAdapter, type SyncContext, type TokenSet } from "./types";

const API = "https://wbsapi.withings.net";

// meastype -> canonical metric (value = value * 10^unit)
const MEASURES: Record<number, string> = {
  1: "weight",
  6: "body_fat",
  9: "bp_diastolic",
  10: "bp_systolic",
  11: "heart_rate",
  54: "spo2",
  71: "body_temp",
  73: "skin_temp",
  76: "muscle_mass",
  77: "hydration",
  88: "bone_mass",
};

async function call<T>(path: string, params: Record<string, string>, accessToken?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => {
    throw new ProviderError(`Withings ${path} returned a non-JSON response (${res.status})`, 502);
  })) as { status: number; body: T; error?: string };
  // 401 is "invalid token": surface it as HTTP 401 so the sync engine refreshes.
  if (json.status !== 0) throw new ProviderError(`Withings ${path} ${params.action}: status ${json.status} ${json.error ?? ""}`, json.status === 401 ? 401 : 400);
  return json.body;
}

async function token(params: Record<string, string>, creds: Credentials): Promise<TokenSet> {
  const b = await call<{ userid: string | number; access_token: string; refresh_token: string; expires_in: number; scope: string }>("/v2/oauth2", {
    action: "requesttoken",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    ...params,
  });
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresAt: new Date(Date.now() + b.expires_in * 1000),
    scopes: b.scope,
    externalUserId: String(b.userid),
  };
}

async function api<T>(ctx: SyncContext, path: string, params: Record<string, string>): Promise<T> {
  try {
    return await call<T>(path, params, await ctx.accessToken());
  } catch (e) {
    if (e instanceof ProviderError && e.status === 401) {
      await ctx.forceRefresh();
      return call<T>(path, params, await ctx.accessToken());
    }
    throw e;
  }
}

const APPLIS = ["1", "4", "16", "44"];

// Connections made before webhook URLs carried the secret key are subscribed to
// the old, unkeyed URL, which is now rejected. Move them over once: drop the old
// subscription, subscribe the keyed URL, and remember that in the cursor.
async function migrateNotify(ctx: SyncContext) {
  if (ctx.connection.cursor?.notify === "keyed") return;
  const keyed = webhookUrl("withings");
  if (!keyed.startsWith("https://")) return;
  const legacy = keyed.slice(0, keyed.indexOf("?"));
  for (const appli of APPLIS) {
    await api(ctx, "/notify", { action: "revoke", callbackurl: legacy, appli }).catch(() => undefined);
    await api(ctx, "/notify", { action: "subscribe", callbackurl: keyed, appli }).catch((e) => ctx.log(`notify ${appli}: ${(e as Error).message}`));
  }
  await db
    .update(connections)
    .set({ cursor: { ...ctx.connection.cursor, notify: "keyed" } })
    .where(eq(connections.id, ctx.connection.id));
}

export const withings: ProviderAdapter = {
  id: "withings",
  envPrefix: "WITHINGS",
  authorize: {
    url: "https://account.withings.com/oauth2_user/authorize2",
    scopes: ["user.info", "user.metrics", "user.activity"],
    scopeSeparator: ",",
  },

  exchangeCode: (code, redirectUri, creds) => token({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, creds),
  refresh: (refreshToken, creds) => token({ grant_type: "refresh_token", refresh_token: refreshToken }, creds),

  // Subscribe this user to change notifications (weight, BP, activity, sleep).
  async afterConnect(t) {
    const callbackurl = webhookUrl("withings");
    if (!callbackurl.startsWith("https://")) return {};
    for (const appli of APPLIS) {
      await call("/notify", { action: "subscribe", callbackurl, appli }, t.accessToken).catch((e) => console.warn("withings notify", appli, e.message));
    }
    return { cursor: { notify: "keyed" } };
  },

  async sync(ctx) {
    const { ingest } = ctx;
    const since = Math.floor(ctx.since.getTime() / 1000);
    await migrateNotify(ctx);

    type Grp = { grpid: number; date: number; model?: string; measures: { value: number; type: number; unit: number }[] };
    let offset = 0;
    do {
      const body = await api<{ measuregrps: Grp[]; more: number; offset: number }>(ctx, "/measure", {
        action: "getmeas",
        meastypes: Object.keys(MEASURES).join(","),
        category: "1",
        lastupdate: String(since),
        ...(offset ? { offset: String(offset) } : {}),
      });
      for (const g of body.measuregrps) {
        const at = new Date(g.date * 1000);
        const rawRecordId = await ingest.raw("measuregrp", g.grpid, g);
        for (const m of g.measures) {
          const metric = MEASURES[m.type];
          if (!metric) continue;
          await ingest.observation({
            metric,
            value: m.value * 10 ** m.unit,
            granularity: "daily",
            day: dayInTz(at, ctx.timezone),
            startTime: at,
            externalId: `grp:${g.grpid}:${m.type}`,
            device: g.model ? { brand: "Withings", model: g.model, kind: "scale" } : null,
            rawRecordId,
          });
        }
      }
      offset = body.more ? body.offset : 0;
    } while (offset);

    const range = { startdateymd: dayWithOffset(ctx.since, 0), enddateymd: addDays(dayWithOffset(new Date(), 0), 1) };

    type SleepSeries = { id: number; date: string; startdate: number; enddate: number; data: Record<string, number | undefined> };
    const sleep = await api<{ series: SleepSeries[] }>(ctx, "/v2/sleep", {
      action: "getsummary",
      ...range,
      data_fields: "total_sleep_time,deepsleepduration,remsleepduration,lightsleepduration,wakeupduration,sleep_efficiency,sleep_score,hr_average,hr_min,rr_average",
    });
    for (const s of sleep.series) {
      const rawRecordId = await ingest.raw("sleep", s.id, s);
      const base = { granularity: "session" as const, day: s.date, startTime: new Date(s.startdate * 1000), endTime: new Date(s.enddate * 1000), rawRecordId };
      const id = `sleep:${s.id}`;
      const d = s.data;
      await ingest.observation({ ...base, metric: "sleep_duration", value: d.total_sleep_time, externalId: `${id}:total` });
      await ingest.observation({ ...base, metric: "sleep_deep", value: d.deepsleepduration, externalId: `${id}:deep` });
      await ingest.observation({ ...base, metric: "sleep_rem", value: d.remsleepduration, externalId: `${id}:rem` });
      await ingest.observation({ ...base, metric: "sleep_light", value: d.lightsleepduration, externalId: `${id}:light` });
      await ingest.observation({ ...base, metric: "sleep_awake", value: d.wakeupduration, externalId: `${id}:awake` });
      await ingest.observation({ ...base, metric: "sleep_efficiency", value: d.sleep_efficiency != null ? d.sleep_efficiency * 100 : null, externalId: `${id}:eff` });
      await ingest.observation({ ...base, metric: "sleep_score", value: d.sleep_score, externalId: `${id}:score` });
      await ingest.observation({ ...base, metric: "resting_hr", value: d.hr_min, externalId: `${id}:rhr` });
      await ingest.observation({ ...base, metric: "respiratory_rate", value: d.rr_average, externalId: `${id}:rr` });
    }

    type Act = { date: string; steps?: number; calories?: number; totalcalories?: number };
    const act = await api<{ activities: Act[] }>(ctx, "/v2/measure", { action: "getactivity", ...range });
    for (const a of act.activities) {
      const rawRecordId = await ingest.raw("activity", a.date, a);
      const base = { granularity: "daily" as const, day: a.date, rawRecordId };
      await ingest.observation({ ...base, metric: "steps", value: a.steps, externalId: `activity:${a.date}:steps` });
      await ingest.observation({ ...base, metric: "active_energy", value: a.calories, externalId: `activity:${a.date}:active` });
      await ingest.observation({ ...base, metric: "total_energy", value: a.totalcalories, externalId: `activity:${a.date}:total` });
    }
  },

  webhook: {
    urlKey: true,
    // Withings probes the callback URL with HEAD/GET when subscribing.
    handshake(req) {
      return req.method === "GET" || req.method === "HEAD" ? new Response("ok") : null;
    },
    parse(_req, body) {
      // Deliveries are form-encoded and unsigned; they only trigger a re-fetch.
      const p = new URLSearchParams(body);
      return { externalUserId: p.get("userid"), sinceHours: 72 };
    },
  },
};
