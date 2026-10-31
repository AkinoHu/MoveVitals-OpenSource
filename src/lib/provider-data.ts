import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "./db";
import { activities, dailyMetrics, devices, observations, rawRecords } from "./db/schema";
import { recomputeGroup, resolveDays } from "./resolve";

export type PurgeResult = { observations: number; activities: number; rawRecords: number };

// Remove everything one source contributed for one user and re-resolve what
// that source touched, so no daily value, group or conflict keeps pointing at it.
export async function deleteProviderData(userId: string, provider: string): Promise<PurgeResult> {
  const days = (
    await db.selectDistinct({ day: observations.day }).from(observations).where(and(eq(observations.userId, userId), eq(observations.provider, provider)))
  )
    .map((r) => r.day)
    .filter((d): d is string => !!d);
  const groupIds = (
    await db.selectDistinct({ id: activities.groupId }).from(activities).where(and(eq(activities.userId, userId), eq(activities.provider, provider)))
  )
    .map((r) => r.id)
    .filter((g): g is string => !!g);

  // Daily rows whose chosen value came from this source are rebuilt below.
  const obs = await db.delete(observations).where(and(eq(observations.userId, userId), eq(observations.provider, provider))).returning({ id: observations.id });
  const acts = await db.delete(activities).where(and(eq(activities.userId, userId), eq(activities.provider, provider))).returning({ id: activities.id });
  const raw = await db.delete(rawRecords).where(and(eq(rawRecords.userId, userId), eq(rawRecords.provider, provider))).returning({ id: rawRecords.id });
  await db.delete(devices).where(and(eq(devices.userId, userId), like(devices.key, `${provider}:%`)));

  for (let i = 0; i < days.length; i += 200) await resolveDays(userId, days.slice(i, i + 200));
  // Rows that still reference a deleted observation (e.g. days with no data left).
  await db.delete(dailyMetrics).where(and(eq(dailyMetrics.userId, userId), eq(dailyMetrics.selectedProvider, provider), inArray(dailyMetrics.day, days.length ? days : [""])));
  for (const g of groupIds) await recomputeGroup(userId, g);
  return { observations: obs.length, activities: acts.length, rawRecords: raw.length };
}
