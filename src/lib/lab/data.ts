// Body Lab queries: lab results, the latest wearable values, and the
// comparisons between lab-grade measurements and the devices that estimate
// the same thing.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { dailyMetrics, labReports, labResults, userAttributes } from "@/lib/db/schema";
import { DOMAINS, MARKERS, type Range } from "./markers";

export type LabResult = typeof labResults.$inferSelect;

export async function userSex(userId: string): Promise<string | null> {
  const [row] = await db.select({ value: userAttributes.value }).from(userAttributes).where(and(eq(userAttributes.userId, userId), eq(userAttributes.key, "sex")));
  return row?.value ?? null;
}

export async function labResultsOf(userId: string, marker?: string): Promise<LabResult[]> {
  return db
    .select()
    .from(labResults)
    .where(marker ? and(eq(labResults.userId, userId), eq(labResults.marker, marker)) : eq(labResults.userId, userId))
    .orderBy(asc(labResults.takenOn), asc(labResults.createdAt));
}

// Latest result per marker.
export function latestByMarker(rows: LabResult[]): Map<string, LabResult> {
  const out = new Map<string, LabResult>();
  for (const r of rows) out.set(r.marker, r); // rows are oldest first
  return out;
}

export async function reportsOf(userId: string) {
  return db
    .select({ id: labReports.id, kind: labReports.kind, title: labReports.title, takenOn: labReports.takenOn, status: labReports.status, filename: labReports.filename, createdAt: labReports.createdAt })
    .from(labReports)
    .where(eq(labReports.userId, userId))
    .orderBy(desc(labReports.createdAt));
}

const LAB_METRICS = [...new Set(DOMAINS.flatMap((d) => d.items.flatMap((i) => ("metric" in i ? [i.metric] : []))))];

// Most recent day with data for each wearable metric shown in the Lab.
export async function latestMetrics(userId: string): Promise<Map<string, { day: string; value: number; provider: string }>> {
  const rows = await db
    .selectDistinctOn([dailyMetrics.metric], { metric: dailyMetrics.metric, day: dailyMetrics.day, value: dailyMetrics.value, provider: dailyMetrics.selectedProvider })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.userId, userId), inArray(dailyMetrics.metric, LAB_METRICS)))
    .orderBy(dailyMetrics.metric, desc(dailyMetrics.day));
  return new Map(rows.map((r) => [r.metric, { day: r.day, value: r.value, provider: r.provider }]));
}

export type Calibration = { marker: string; metric: string; day: string; lab: number; device: number; deviceDay: string; provider: string };

// For each lab-grade test with a device equivalent (DEXA vs smart scale,
// lab VO2 max vs watch, fasting glucose vs CGM), the device reading closest
// in time (within 14 days) to the latest test.
export async function calibrations(userId: string, latest: Map<string, LabResult>): Promise<Calibration[]> {
  const pairs = MARKERS.filter((m) => m.metric && latest.has(m.code)).map((m) => ({ marker: m.code, metric: m.metric!, result: latest.get(m.code)! }));
  if (!pairs.length) return [];
  const rows = await db
    .select({ metric: dailyMetrics.metric, day: dailyMetrics.day, value: dailyMetrics.value, provider: dailyMetrics.selectedProvider })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.userId, userId), inArray(dailyMetrics.metric, [...new Set(pairs.map((p) => p.metric))])));
  const out: Calibration[] = [];
  for (const p of pairs) {
    const target = Date.parse(p.result.takenOn);
    if (p.marker === "hba1c") {
      // CGM glucose management indicator (GMI, Bergenstal 2018) over the 90
      // days before the test, comparable to a lab HbA1c.
      const window = rows.filter((r) => r.metric === "blood_glucose" && Date.parse(r.day) <= target && Date.parse(r.day) > target - 90 * 86400_000);
      if (window.length >= 14) {
        const mean = window.reduce((a, r) => a + r.value, 0) / window.length;
        const last = window.reduce((a, r) => (r.day > a.day ? r : a));
        out.push({ marker: p.marker, metric: "gmi", day: p.result.takenOn, lab: p.result.value, device: 3.31 + 0.02392 * mean, deviceDay: last.day, provider: last.provider });
      }
      continue;
    }
    let best: (typeof rows)[number] | null = null;
    for (const r of rows) {
      if (r.metric !== p.metric) continue;
      const d = Math.abs(Date.parse(r.day) - target);
      if (d <= 14 * 86400_000 && (!best || d < Math.abs(Date.parse(best.day) - target))) best = r;
    }
    if (best) out.push({ marker: p.marker, metric: p.metric, day: p.result.takenOn, lab: p.result.value, device: best.value, deviceDay: best.day, provider: best.provider });
  }
  return out;
}

export const printedRange = (r: LabResult): Range | null => (r.refLow != null || r.refHigh != null ? { low: r.refLow ?? undefined, high: r.refHigh ?? undefined } : null);

// Decrypted report file, for its owner only (used by the download route).
export async function reportFile(userId: string, id: string) {
  const [r] = await db.select({ mime: labReports.mime, filename: labReports.filename, fileEnc: labReports.fileEnc }).from(labReports).where(and(eq(labReports.id, id), eq(labReports.userId, userId)));
  return r ? { mime: r.mime, filename: r.filename, data: Buffer.from(decrypt(r.fileEnc), "base64") } : null;
}
