// Personal baselines: what "normal" looks like for this user, per metric.
//
// The baseline is the median of the 60 days before the most recent week,
// with a robust spread (1.4826 × MAD, never narrower than the metric's own
// measurement tolerance). The recent value is the mean of the last three
// days with data. Alerts fire only on sustained or combined changes, never on
// one odd night.

import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyMetrics } from "@/lib/db/schema";
import { METRIC_MAP } from "@/lib/metrics";
import { addDays, dayInTz } from "@/lib/time";

// +1: higher is worse, -1: lower is worse, 0: neither (report, don't warn).
export const ADVERSE: Record<string, 1 | -1 | 0> = {
  hrv_rmssd: -1,
  hrv_sdnn: -1,
  resting_hr: 1,
  respiratory_rate: 1,
  temp_deviation: 1,
  skin_temp: 1,
  spo2: -1,
  sleep_duration: -1,
  sleep_efficiency: -1,
  bp_systolic: 1,
  bp_diastolic: 1,
  blood_glucose: 1,
  vo2max: -1,
  weight: 0,
  body_fat: 0,
};

export const BASELINE_METRICS = Object.keys(ADVERSE);

const WINDOW = 60;
const RECENT = 7;
const MIN_DAYS = 14;

export type Baseline = {
  metric: string;
  n: number;
  median: number;
  low: number;
  high: number;
  recent: number | null;
  recentDays: string[];
  z: number | null;
  // Every one of the last three readings sits ≥1.5 spreads away, same side.
  sustained: boolean;
  direction: "up" | "down" | null;
  adverse: boolean;
};

export type Alert = { kind: "strain"; metrics: string[]; z: number } | { kind: "metric"; metric: string; direction: "up" | "down"; z: number; adverse: boolean };

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function computeBaseline(metric: string, series: { day: string; value: number }[], today: string): Baseline | null {
  const cutoff = addDays(today, -RECENT);
  const start = addDays(today, -RECENT - WINDOW);
  const past = series.filter((p) => p.day >= start && p.day < cutoff).map((p) => p.value);
  if (past.length < MIN_DAYS) return null;
  const med = median(past);
  const mad = median(past.map((v) => Math.abs(v - med)));
  const tol = METRIC_MAP[metric]?.tolerance ?? 0.05;
  const spread = Math.max(1.4826 * mad, Math.abs(med) * tol * 0.5, 1e-9);

  const recentPts = series
    .filter((p) => p.day >= addDays(today, -3))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-3);
  const recent = recentPts.length ? recentPts.reduce((a, p) => a + p.value, 0) / recentPts.length : null;
  const z = recent == null ? null : (recent - med) / spread;
  const zs = recentPts.map((p) => (p.value - med) / spread);
  const sustained = zs.length >= 3 && (zs.every((x) => x >= 1.5) || zs.every((x) => x <= -1.5));
  const direction = z == null || Math.abs(z) < 1 ? null : z > 0 ? "up" : "down";
  const sign = ADVERSE[metric] ?? 0;
  const adverse = direction != null && sign !== 0 && (direction === "up" ? sign > 0 : sign < 0);
  return { metric, n: past.length, median: med, low: med - spread, high: med + spread, recent, recentDays: recentPts.map((p) => p.day), z, sustained, direction, adverse };
}

export async function baselinesFor(userId: string, timezone: string, metrics = BASELINE_METRICS): Promise<{ today: string; baselines: Record<string, Baseline>; series: Record<string, { day: string; value: number }[]> }> {
  const today = dayInTz(new Date(), timezone);
  const rows = await db
    .select({ day: dailyMetrics.day, metric: dailyMetrics.metric, value: dailyMetrics.value })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.userId, userId), gte(dailyMetrics.day, addDays(today, -RECENT - WINDOW)), inArray(dailyMetrics.metric, metrics)));
  const series: Record<string, { day: string; value: number }[]> = {};
  for (const r of rows) (series[r.metric] ??= []).push({ day: r.day, value: r.value });
  const baselines: Record<string, Baseline> = {};
  for (const m of metrics) {
    const b = series[m] && computeBaseline(m, series[m], today);
    if (b) baselines[m] = b;
  }
  return { today, baselines, series };
}

// Signals that together usually mean illness, heavy fatigue or poor recovery.
const STRAIN = ["hrv_rmssd", "hrv_sdnn", "resting_hr", "respiratory_rate", "temp_deviation", "skin_temp"];

export function alertsFrom(baselines: Record<string, Baseline>): Alert[] {
  const alerts: Alert[] = [];
  const strain = STRAIN.map((m) => baselines[m]).filter((b): b is Baseline => !!b && b.adverse && Math.abs(b.z ?? 0) >= 1);
  const covered = new Set<string>();
  if (strain.length >= 2) {
    alerts.push({ kind: "strain", metrics: strain.map((b) => b.metric), z: Math.max(...strain.map((b) => Math.abs(b.z ?? 0))) });
    strain.forEach((b) => covered.add(b.metric));
  }
  for (const b of Object.values(baselines)) {
    if (covered.has(b.metric) || !b.sustained || !b.direction) continue;
    alerts.push({ kind: "metric", metric: b.metric, direction: b.direction, z: Math.abs(b.z ?? 0), adverse: b.adverse });
  }
  // Adverse first, then by size of the change.
  return alerts.sort((a, b) => Number(b.kind === "strain" || (b.kind === "metric" && b.adverse)) - Number(a.kind === "strain" || (a.kind === "metric" && a.adverse)) || b.z - a.z);
}
