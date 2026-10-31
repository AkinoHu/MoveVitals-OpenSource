// Dexcom API v3 — https://developer.dexcom.com
// Continuous glucose. We keep raw EGV windows and derive per-day mean glucose
// and time-in-range (70–180 mg/dL). Set DEXCOM_ENV=sandbox for the sandbox.
import { addDays, dayInTz } from "../time";
import { tokenRequest, toTokenSet } from "./oauth";
import type { ProviderAdapter } from "./types";

const base = () => (process.env.DEXCOM_ENV === "sandbox" ? "https://sandbox-api.dexcom.com" : "https://api.dexcom.com");
const WINDOW_DAYS = 30; // API maximum per request
const MAX_BACKFILL_DAYS = 90;

type Egv = { recordId: string; systemTime: string; value: number | null; unit?: string };

// mg/dL readings grouped by local day → mean and % time in 70–180.
export function summariseEgvs(egvs: Egv[], timezone: string) {
  const days = new Map<string, number[]>();
  for (const e of egvs) {
    if (e.value == null) continue;
    const day = dayInTz(new Date(`${e.systemTime.replace(/Z?$/, "Z")}`), timezone);
    days.set(day, [...(days.get(day) ?? []), e.value]);
  }
  return [...days].map(([day, vals]) => ({
    day,
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    tir: (vals.filter((v) => v >= 70 && v <= 180).length / vals.length) * 100,
    count: vals.length,
  }));
}

const fmt = (d: Date) => d.toISOString().slice(0, 19);

export const dexcom: ProviderAdapter = {
  id: "dexcom",
  envPrefix: "DEXCOM",
  authorize: { url: `${base()}/v2/oauth2/login`, scopes: ["offline_access"] },

  async exchangeCode(code, redirectUri, creds) {
    return toTokenSet(await tokenRequest(`${base()}/v2/oauth2/token`, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, creds));
  },

  async refresh(refreshToken, creds) {
    return toTokenSet(await tokenRequest(`${base()}/v2/oauth2/token`, { grant_type: "refresh_token", refresh_token: refreshToken }, creds));
  },

  async sync(ctx) {
    const earliest = new Date(Date.now() - MAX_BACKFILL_DAYS * 86400_000);
    const since = ctx.since < earliest ? earliest : ctx.since;
    // Start on a whole local day so daily stats are never computed from a partial day.
    const firstDay = addDays(dayInTz(since, ctx.timezone), 1);
    const egvs: Egv[] = [];
    for (let from = since; from < new Date(); from = new Date(from.getTime() + WINDOW_DAYS * 86400_000)) {
      const to = new Date(Math.min(from.getTime() + WINDOW_DAYS * 86400_000, Date.now()));
      const res = await ctx.api<{ records: Egv[] }>(`${base()}/v3/users/self/egvs?startDate=${fmt(from)}&endDate=${fmt(to)}`);
      if (res.records?.length) {
        await ctx.ingest.raw("egvs", `${fmt(from)}_${fmt(to)}`, res.records);
        egvs.push(...res.records);
      }
    }
    for (const d of summariseEgvs(egvs, ctx.timezone)) {
      if (d.day < firstDay || d.count < 12) continue; // need ≥ 1 h of readings
      const obs = { granularity: "daily" as const, day: d.day, device: { brand: "Dexcom", model: "Dexcom CGM", kind: "cgm" } };
      await ctx.ingest.observation({ ...obs, metric: "blood_glucose", value: d.mean, externalId: `egv:${d.day}:mean` });
      await ctx.ingest.observation({ ...obs, metric: "glucose_tir", value: d.tir, externalId: `egv:${d.day}:tir` });
    }
  },
};
