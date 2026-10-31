// COROS via its MCP server — https://github.com/coroslab/coros-mcp
//
// COROS has no public REST API; its self-service path is an MCP server with
// OAuth 2.0 (dynamic client registration, PKCE). Accounts live in one of
// three regions, each with its own authorization server, so the region is
// chosen at connect time, carried through the OAuth state and kept in the
// connection cursor. Tools return text written for language models; the
// parsers below read the fields we need and keep the full text as raw data.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { oauthClients } from "../db/schema";
import { decryptOpt, encryptOpt } from "../crypto";
import { addDays, dayWithOffset } from "../time";
import { McpClient } from "./mcp";
import { tokenRequest, toTokenSet } from "./oauth";
import { ProviderError, type Connection, type Credentials, type ProviderAdapter, type SyncContext } from "./types";

export const COROS_REGIONS = { cn: "https://mcpcn.coros.com", eu: "https://mcpeu.coros.com", us: "https://mcpus.coros.com" } as const;
export type CorosRegion = keyof typeof COROS_REGIONS;
const isRegion = (r: unknown): r is CorosRegion => typeof r === "string" && r in COROS_REGIONS;
const SCOPES = "openid mcp.tools offline_access";
const DEVICE = { brand: "COROS", model: "COROS", kind: "watch" };

// The client registered with this region's authorization server for this
// deployment's redirect URI, registering it on first use.
async function clientFor(region: CorosRegion, redirectUri: string): Promise<Credentials> {
  const issuer = COROS_REGIONS[region];
  const where = and(eq(oauthClients.provider, "coros"), eq(oauthClients.issuer, issuer), eq(oauthClients.redirectUri, redirectUri));
  const [row] = await db.select().from(oauthClients).where(where);
  if (row) return { clientId: row.clientId, clientSecret: decryptOpt(row.clientSecretEnc) ?? "" };

  const res = await fetch(`${issuer}/connect/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "MoveVitals",
      client_uri: new URL(redirectUri).origin,
      logo_uri: `${new URL(redirectUri).origin}/logo.png`,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: SCOPES,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { client_id?: string; client_secret?: string };
  if (!res.ok || !json.client_id) throw new ProviderError(`COROS client registration failed (${res.status})`, res.status);
  await db
    .insert(oauthClients)
    .values({ provider: "coros", issuer, redirectUri, clientId: json.client_id, clientSecretEnc: encryptOpt(json.client_secret) })
    .onConflictDoNothing();
  return { clientId: json.client_id, clientSecret: json.client_secret ?? "" };
}

const regionOf = (c?: Connection | null): CorosRegion => (isRegion(c?.cursor?.region) ? c.cursor.region : "us");
const redirectFor = () => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/connections/coros/callback`;

// `sub` from the OpenID id_token, used as the stable account id.
function subject(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    return (JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parsers for the tools' text output (formats as returned in October 2026)
// ---------------------------------------------------------------------------

const ymd = (d: string) => d.replace(/-/g, "");
const isoDay = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

// "7h 57min" / "1:37:26" / "40 min" → seconds
export function seconds(s: string | undefined): number | null {
  if (!s) return null;
  const hms = s.match(/(\d+):(\d{2}):(\d{2})/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const ms = s.match(/^\s*(\d+):(\d{2})\s*$/);
  if (ms) return +ms[1] * 60 + +ms[2];
  const h = s.match(/(\d+(?:\.\d+)?)\s*h\b/);
  const m = s.match(/(\d+(?:\.\d+)?)\s*min/);
  return h || m ? Math.round((h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0)) : null;
}
const num = (s: string | undefined) => {
  const m = s?.replace(/(\d),(\d{3})/g, "$1$2").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
// "Key: value | Key: value" pairs anywhere in a block, keys lower-cased.
function fields(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of block.split(/\n|\|/)) {
    const kv = part.match(/^\s*([A-Za-z][\w ()>./-]*?):\s*(.*?)\s*$/);
    if (kv && !out.has(kv[1].toLowerCase())) out.set(kv[1].toLowerCase(), kv[2]);
  }
  return out;
}
// Splits text on a date header and returns [day, body] pairs.
function sections(text: string, header: RegExp, toDay = (d: string) => d): [string, string][] {
  const parts = text.split(header);
  const out: [string, string][] = [];
  for (let i = 1; i < parts.length; i += 2) out.push([toDay(parts[i]), parts[i + 1] ?? ""]);
  return out;
}

export type SleepDay = { day: string; score: number | null; total: number | null; deep: number | null; light: number | null; rem: number | null; awake: number | null; start: Date | null; end: Date | null };

// querySleepOverview: "2026-10-18\nSleep Score: 62\nMain Sleep (asleep): 5h 33min\n…"
// "2026-10-17 23:42" in the account's timezone → instant.
export function localTime(s: string, timezone: string): Date {
  const naive = new Date(`${s.replace(" ", "T")}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(naive).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(naive.getTime() - (asLocal - naive.getTime()));
}

export function parseSleepOverview(text: string, timezone = "UTC"): SleepDay[] {
  return sections(text, /^(\d{4}-\d{2}-\d{2})\s*$/m).flatMap(([day, body]) => {
    const f = fields(body);
    const total = seconds(f.get("main sleep (asleep)") ?? f.get("daily sleep"));
    if (!total) return [];
    const part = (k: string) => {
      const p = num(f.get(k));
      return p == null ? null : Math.round((total * p) / 100);
    };
    const win = f.get("main sleep window")?.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*-\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    return [{ day, score: num(f.get("sleep score")) || null, total, deep: part("deep sleep ratio"), light: part("light sleep ratio"), rem: part("rem ratio"), awake: seconds(f.get("awake time")), start: win ? localTime(win[1], timezone) : null, end: win ? localTime(win[2], timezone) : null }];
  });
}

// querySleepHrv: "2026-10-18:\n  HRV Avg: 72 ms — Normal" (the time series that
// follows repeats the date without an average and is ignored).
export function parseSleepHrv(text: string): { day: string; hrv: number }[] {
  return [...text.matchAll(/^(\d{4}-\d{2}-\d{2}):\s*\n\s*HRV Avg:\s*(\d+(?:\.\d+)?)\s*ms/gm)].map((m) => ({ day: m[1], hrv: Number(m[2]) }));
}

// queryRestingHeartRate: "2026-10-18: 52 bpm"
export function parseRestingHr(text: string): { day: string; bpm: number }[] {
  return [...text.matchAll(/^(\d{4}-\d{2}-\d{2}):\s*(\d{2,3})\s*bpm/gm)].map((m) => ({ day: m[1], bpm: Number(m[2]) }));
}

export type DailyHealth = { day: string; steps: number | null; calories: number | null; stress: number | null; sleep: { deep: number | null; light: number | null; rem: number | null; awake: number | null } | null };

// queryDailyHealthData: "--- 20261018 ---\nSteps: 7,738 | Calories: 1,297 kcal | …"
// Days the watch wasn't worn come back as zeros and are skipped.
export function parseDailyHealth(text: string): DailyHealth[] {
  return sections(text, /^--- (\d{8}) ---\s*$/m, isoDay).flatMap(([day, body]) => {
    const f = fields(body);
    const steps = num(f.get("steps"));
    const calories = num(f.get("calories"));
    if (!steps && !calories) return [];
    const sleepAt = body.indexOf("Sleep Summary");
    const s = sleepAt >= 0 ? fields(body.slice(sleepAt)) : null;
    return [
      {
        day,
        steps,
        calories,
        stress: num(f.get("stress")),
        sleep: s && seconds(s.get("deep")) != null ? { deep: seconds(s.get("deep")), light: seconds(s.get("light")), rem: seconds(s.get("rem")), awake: seconds(s.get("awake")) } : null,
      },
    ];
  });
}

// "24.56 km" / "110 m"
const distanceKm = (s: string | undefined) => {
  const v = num(s);
  return v == null ? null : /\bm\b/.test(s ?? "") && !/km/.test(s ?? "") ? v / 1000 : v;
};

export type SportRecord = { id: string; sport: string; sportType: string | null; start: Date; end: Date; seconds: number | null; distanceKm: number | null; avgHr: number | null; avgSpeedKmh: number | null; calories: number | null; location: string | null; block: string };

// querySportRecords: numbered entries with a time window and LabelId.
export function parseSportRecords(text: string): SportRecord[] {
  return text
    .split(/\n(?=\d+\.\s)/)
    .filter((b) => /^\d+\.\s/.test(b))
    .flatMap((block) => {
      const head = block.match(/^\d+\.\s*(.+?)\s+—\s+(\d{4}-\d{2}-\d{2})/);
      const st = block.match(/startTimestamp=(\d+)/);
      const et = block.match(/endTimestamp=(\d+)/);
      const id = block.match(/LabelId:\s*(\d+)/);
      if (!head || !st || !id) return [];
      const f = fields(block);
      const start = new Date(Number(st[1]) * 1000);
      return [
        {
          id: id[1],
          sport: head[1],
          sportType: block.match(/SportType:\s*(\d+)/)?.[1] ?? null,
          start,
          end: et ? new Date(Number(et[1]) * 1000) : start,
          seconds: seconds(f.get("duration")),
          distanceKm: distanceKm(f.get("distance")),
          avgHr: num(f.get("avg hr")),
          avgSpeedKmh: num(f.get("average speed")),
          calories: num(f.get("calories")),
          location: f.get("location") ?? null,
          block,
        },
      ];
    });
}

export const coros: ProviderAdapter = {
  id: "coros",
  envPrefix: "COROS",
  dynamicClient: true,
  authorize: {
    url: `${COROS_REGIONS.us}/oauth2/authorize`,
    scopes: SCOPES.split(" "),
    pkce: true,
    async build({ state, codeChallenge, redirectUri, query }) {
      const region = isRegion(query.get("region")) ? (query.get("region") as CorosRegion) : "us";
      const client = await clientFor(region, redirectUri);
      const url = new URL(`${COROS_REGIONS[region]}/oauth2/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", SCOPES);
      url.searchParams.set("state", state);
      url.searchParams.set("resource", `${COROS_REGIONS[region]}/mcp`);
      if (codeChallenge) {
        url.searchParams.set("code_challenge", codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
      }
      return { url: url.toString(), extra: { region } };
    },
  },

  async exchangeCode(code, redirectUri, _creds, codeVerifier, extra) {
    const region = isRegion(extra?.region) ? extra.region : "us";
    const client = await clientFor(region, redirectUri);
    const raw = await tokenRequest(
      `${COROS_REGIONS[region]}/oauth2/token`,
      { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier ?? "", resource: `${COROS_REGIONS[region]}/mcp` },
      client,
    );
    return { ...toTokenSet(raw), externalUserId: subject(raw.id_token), displayName: null, cursor: { region } };
  },

  async refresh(refreshToken, _creds, connection) {
    const region = regionOf(connection);
    const client = await clientFor(region, redirectFor());
    return toTokenSet(await tokenRequest(`${COROS_REGIONS[region]}/oauth2/token`, { grant_type: "refresh_token", refresh_token: refreshToken }, client));
  },

  async sync(ctx) {
    await syncCoros(ctx);
  },
};

async function syncCoros(ctx: SyncContext) {
  const client = new McpClient(`${COROS_REGIONS[regionOf(ctx.connection)]}/mcp`, ctx.accessToken);
  // Local development keeps each tool's text output for checking parsers.
  const debugDir = process.env.NODE_ENV !== "production" ? (await import("node:path")).join(process.cwd(), ".data", "coros-debug") : null;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const out = await client.text(name, args);
    if (debugDir) {
      const fs = await import("node:fs/promises");
      await fs.mkdir(debugDir, { recursive: true });
      await fs.appendFile(`${debugDir}/${name}.txt`, `\n===== ${JSON.stringify(args)}\n${out}\n`);
    }
    return out;
  };
  const { ingest } = ctx;
  const today = dayWithOffset(new Date(), 0);
  const start = dayWithOffset(ctx.since, 0);
  const days = Math.min(90, Math.max(7, Math.ceil((Date.now() - ctx.since.getTime()) / 86400_000) + 1));

  // Sleep and HRV take at most 7 days per call.
  for (let to = today; to >= start; to = addDays(to, -7)) {
    const from = addDays(to, -6) < start ? start : addDays(to, -6);
    const range = { startDate: ymd(from), endDate: ymd(to) };

    const sleepText = await call("querySleepOverview", range);
    const sleepRaw = await ingest.raw("sleep_overview", `${from}_${to}`, { text: sleepText });
    for (const s of parseSleepOverview(sleepText, ctx.timezone)) {
      const base = { granularity: "daily" as const, day: s.day, startTime: s.start, endTime: s.end, device: DEVICE, rawRecordId: sleepRaw };
      await ingest.observation({ ...base, metric: "sleep_score", value: s.score, externalId: `sleep:${s.day}:score` });
      await ingest.observation({ ...base, metric: "sleep_duration", value: s.total, externalId: `sleep:${s.day}:total` });
      await ingest.observation({ ...base, metric: "sleep_deep", value: s.deep, externalId: `sleep:${s.day}:deep` });
      await ingest.observation({ ...base, metric: "sleep_light", value: s.light, externalId: `sleep:${s.day}:light` });
      await ingest.observation({ ...base, metric: "sleep_rem", value: s.rem, externalId: `sleep:${s.day}:rem` });
      await ingest.observation({ ...base, metric: "sleep_awake", value: s.awake, externalId: `sleep:${s.day}:awake` });
    }

    const hrvText = await call("querySleepHrv", range);
    const hrvRaw = await ingest.raw("sleep_hrv", `${from}_${to}`, { text: hrvText });
    for (const h of parseSleepHrv(hrvText)) {
      await ingest.observation({ granularity: "daily", day: h.day, device: DEVICE, rawRecordId: hrvRaw, metric: "hrv_rmssd", value: h.hrv, externalId: `hrv:${h.day}` });
    }
  }

  const rhrText = await call("queryRestingHeartRate", { days });
  const rhrRaw = await ingest.raw("resting_hr", `${today}:${days}`, { text: rhrText });
  for (const r of parseRestingHr(rhrText)) {
    await ingest.observation({ granularity: "daily", day: r.day, device: DEVICE, rawRecordId: rhrRaw, metric: "resting_hr", value: r.bpm, externalId: `rhr:${r.day}` });
  }

  // Daily totals; its sleep summary has stage minutes, which are more exact
  // than the overview's rounded ratios and replace them.
  const dailyText = await call("queryDailyHealthData", { days });
  const dailyRaw = await ingest.raw("daily_health", `${today}:${days}`, { text: dailyText });
  for (const d of parseDailyHealth(dailyText)) {
    const base = { granularity: "daily" as const, day: d.day, device: DEVICE, rawRecordId: dailyRaw };
    await ingest.observation({ ...base, metric: "steps", value: d.steps, externalId: `daily:${d.day}:steps` });
    await ingest.observation({ ...base, metric: "active_energy", value: d.calories, externalId: `daily:${d.day}:kcal` });
    await ingest.observation({ ...base, metric: "stress", value: d.stress, externalId: `daily:${d.day}:stress` });
    if (d.sleep) {
      await ingest.observation({ ...base, metric: "sleep_deep", value: d.sleep.deep, externalId: `sleep:${d.day}:deep` });
      await ingest.observation({ ...base, metric: "sleep_light", value: d.sleep.light, externalId: `sleep:${d.day}:light` });
      await ingest.observation({ ...base, metric: "sleep_rem", value: d.sleep.rem, externalId: `sleep:${d.day}:rem` });
      await ingest.observation({ ...base, metric: "sleep_awake", value: d.sleep.awake, externalId: `sleep:${d.day}:awake` });
    }
  }

  // VO2 max is a current value only; record it for today.
  const fitness = await call("queryFitnessAssessmentOverview");
  const vo2 = num(fitness.match(/VO2\s*max:\s*([\d.]+)/i)?.[1]);
  if (vo2) {
    const rawRecordId = await ingest.raw("fitness", today, { text: fitness });
    await ingest.observation({ granularity: "daily", day: today, device: DEVICE, rawRecordId, metric: "vo2max", value: vo2, externalId: `vo2max:${today}` });
  }

  for (let to = today; to >= start; to = addDays(to, -30)) {
    const from = addDays(to, -29) < start ? start : addDays(to, -29);
    for (const a of parseSportRecords(await call("querySportRecords", { startDate: ymd(from), endDate: ymd(to), limit: 100 }))) {
      await ingest.activity({
        externalId: a.id,
        // Location reads "北京市 Run" or "Indoor Bike": keep only a place name.
        name: a.location && !/^indoor\b/i.test(a.location) ? `${a.sport} · ${a.location.split(/\s+/)[0]}` : a.sport,
        sportRaw: a.sport,
        startTime: a.start,
        endTime: a.end,
        elapsedSeconds: Math.round((a.end.getTime() - a.start.getTime()) / 1000) || a.seconds,
        movingSeconds: a.seconds,
        distanceM: a.distanceKm != null ? a.distanceKm * 1000 : null,
        avgHr: a.avgHr,
        avgSpeed: a.avgSpeedKmh != null ? a.avgSpeedKmh / 3.6 : null,
        calories: a.calories,
        device: DEVICE,
        rawRecordId: await ingest.raw("sport_record", a.id, { text: a.block }),
      });
    }
  }
}
