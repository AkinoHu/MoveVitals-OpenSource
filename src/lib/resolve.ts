// Conflict resolution. Raw observations and activities from every source are
// kept; this module decides which value is shown and records why.
//
// Daily metrics: candidates per (day, metric) are ranked by
//   manual override > user priority for the metric > user priority for the
//   category > built-in default priority.
// Activities: overlapping workouts with compatible sports are clustered into
// an activity_group, and each field is picked independently (e.g. power from
// the trainer, heart rate from the chest strap, GPS distance from the watch).

import { and, eq, gt, inArray, lt, ne, or, isNull, sql } from "drizzle-orm";
import { db, type Db } from "./db";
import { activities, activityGroups, dailyMetrics, dailyOverrides, observations, sourcePriorities, type CandidateValue, type FieldSource } from "./db/schema";
import { METRIC_MAP, type MetricCategory } from "./metrics";
import { sportsCompatible, type Sport } from "./sports";

// ---------------------------------------------------------------------------
// Per-user serialisation
// ---------------------------------------------------------------------------
// resolveDays rewrites daily_metrics and groupActivity/recomputeGroup rewrite
// activity groups. Web requests, webhook handlers and the worker can all do that
// for one user at once, so every public entry point runs in a transaction that
// first takes a per-user advisory lock (released automatically on commit).

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function withUserLock<T>(userId: string, fn: (q: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`resolve:${userId}`}, 0))`);
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------
// Default priorities
// ---------------------------------------------------------------------------

export const DEFAULT_CATEGORY_PRIORITY: Record<MetricCategory, string[]> = {
  recovery: ["whoop", "oura", "polar", "garmin", "apple_health", "coros", "withings", "strava"],
  sleep: ["oura", "whoop", "withings", "polar", "garmin", "apple_health", "coros"],
  heart: ["whoop", "oura", "polar", "garmin", "apple_health", "withings", "coros"],
  activity: ["apple_health", "garmin", "oura", "coros", "withings", "polar", "whoop"],
  body: ["withings", "garmin", "apple_health", "whoop", "oura"],
  vitals: ["withings", "oura", "whoop", "apple_health", "garmin", "polar"],
  metabolic: ["dexcom", "apple_health", "garmin", "whoop", "oura"],
};

export const ACTIVITY_FIELDS = [
  "name",
  "sport",
  "distanceM",
  "elevationGainM",
  "movingSeconds",
  "elapsedSeconds",
  "avgHr",
  "maxHr",
  "avgPower",
  "normalizedPower",
  "avgCadence",
  "avgSpeed",
  "calories",
  "strain",
  "trainingLoad",
] as const;
export type ActivityField = (typeof ACTIVITY_FIELDS)[number];

// Relayed activities (e.g. Zwift via Strava) are ranked by their original
// recorder, so "zwift" here means "a Zwift ride, whichever platform relayed it":
// its power comes from the smart trainer and heart rate usually from a strap.
const HR = ["polar", "zwift", "garmin", "coros", "wahoo", "suunto", "concept2", "apple_health", "whoop", "oura", "strava"];
const POWER = ["zwift", "wahoo", "garmin", "coros", "polar", "suunto", "concept2", "mywhoosh", "rouvy", "apple_health", "strava", "whoop"];
const GPS = ["coros", "garmin", "suunto", "apple_health", "polar", "wahoo", "concept2", "strava", "whoop", "oura"];
const META = ["strava", "zwift", "mywhoosh", "rouvy", "garmin", "coros", "polar", "suunto", "wahoo", "concept2", "apple_health", "whoop", "oura"];

export const DEFAULT_ACTIVITY_PRIORITY: Record<ActivityField, string[]> = {
  name: META,
  sport: META,
  distanceM: GPS,
  elevationGainM: GPS,
  movingSeconds: GPS,
  elapsedSeconds: GPS,
  avgHr: HR,
  maxHr: HR,
  avgPower: POWER,
  normalizedPower: POWER,
  avgCadence: POWER,
  avgSpeed: GPS,
  calories: ["whoop", "apple_health", "garmin", "coros", "polar", "strava", "oura"],
  strain: ["whoop"],
  trainingLoad: ["polar", "garmin", "coros", "strava"],
};

// Fields where disagreement beyond this relative spread is flagged.
const ACTIVITY_TOLERANCE: Partial<Record<ActivityField, number>> = {
  distanceM: 0.05,
  avgHr: 0.05,
  maxHr: 0.05,
  avgPower: 0.05,
  calories: 0.25,
};

export type PriorityMap = Map<string, string[]>;

export async function loadPriorities(userId: string, q: Pick<Db, "select"> = db): Promise<PriorityMap> {
  const rows = await q.select().from(sourcePriorities).where(eq(sourcePriorities.userId, userId));
  return new Map(rows.map((r) => [r.scope, r.providers]));
}

function rank(order: string[], provider: string): number {
  const i = order.indexOf(provider);
  return i === -1 ? order.length + 1 : i;
}

const ORIGINS: [RegExp, string][] = [
  [/zwift/i, "zwift"],
  [/mywhoosh/i, "mywhoosh"],
  [/rouvy/i, "rouvy"],
  [/garmin|edge|forerunner|fenix|epix/i, "garmin"],
  [/coros|vertix|pace|apex|dura/i, "coros"],
  [/polar/i, "polar"],
  [/wahoo|elemnt|kickr/i, "wahoo"],
  [/suunto/i, "suunto"],
  [/apple watch|watchos/i, "apple_health"],
];

// Ranking key for an activity: its original recorder when relayed.
export function sourceKey(a: { provider: string; origin: string | null }): string {
  if (a.origin) for (const [re, key] of ORIGINS) if (re.test(a.origin)) return key;
  return a.provider;
}

// Best of the origin's and the relaying provider's position in `order`.
function rankActivity(order: string[], a: { provider: string; origin: string | null }): number {
  return Math.min(rank(order, sourceKey(a)), rank(order, a.provider));
}

export function metricOrder(metric: string, prio: PriorityMap): string[] {
  const cat = METRIC_MAP[metric]?.category ?? "vitals";
  return prio.get(metric) ?? prio.get(cat) ?? DEFAULT_CATEGORY_PRIORITY[cat];
}

export function activityOrder(field: ActivityField, prio: PriorityMap): string[] {
  return prio.get(`activity.${field}`) ?? prio.get("activity") ?? DEFAULT_ACTIVITY_PRIORITY[field];
}

function aggregate(values: number[], agg: "last" | "sum" | "avg" | "max" | "min"): number {
  switch (agg) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    default:
      return values[values.length - 1];
  }
}

function spread(values: number[], ref: number): number {
  if (values.length < 2) return 0;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const base = Math.abs(ref) || Math.max(Math.abs(max), Math.abs(min)) || 1;
  return (max - min) / base;
}

// ---------------------------------------------------------------------------
// Daily metrics
// ---------------------------------------------------------------------------

export async function resolveDays(userId: string, days: string[]): Promise<number> {
  if (days.length === 0) return 0;
  return withUserLock(userId, (q) => resolveDaysImpl(q, userId, days));
}

async function resolveDaysImpl(q: Tx, userId: string, days: string[]): Promise<number> {
  const prio = await loadPriorities(userId, q);
  let written = 0;

  for (let i = 0; i < days.length; i += 60) {
    const chunk = days.slice(i, i + 60);
    const [obs, overrides] = await Promise.all([
      q
        .select()
        .from(observations)
        .where(and(eq(observations.userId, userId), inArray(observations.day, chunk), ne(observations.granularity, "sample")))
        .orderBy(observations.startTime),
      q.select().from(dailyOverrides).where(and(eq(dailyOverrides.userId, userId), inArray(dailyOverrides.day, chunk))),
    ]);

    // day|metric -> provider -> observations
    const groups = new Map<string, Map<string, typeof obs>>();
    for (const o of obs) {
      if (!o.day) continue;
      const key = `${o.day}|${o.metric}`;
      const byProvider = groups.get(key) ?? new Map();
      byProvider.set(o.provider, [...(byProvider.get(o.provider) ?? []), o]);
      groups.set(key, byProvider);
    }
    const overrideMap = new Map(overrides.map((o) => [`${o.day}|${o.metric}`, o.provider]));

    // Replace this chunk atomically (we are inside the user-locked transaction).
    await q.delete(dailyMetrics).where(and(eq(dailyMetrics.userId, userId), inArray(dailyMetrics.day, chunk)));

    const rows: (typeof dailyMetrics.$inferInsert)[] = [];
    for (const [key, byProvider] of groups) {
      const [day, metric] = key.split("|");
      const def = METRIC_MAP[metric];
      const agg = def?.dailyAgg ?? "last";
      const candidates: CandidateValue[] = [...byProvider.entries()].map(([provider, list]) => ({
        provider,
        origin: list[list.length - 1].origin,
        value: aggregate(
          list.map((o) => o.value),
          agg,
        ),
        observationId: list[list.length - 1].id,
      }));

      const order = metricOrder(metric, prio);
      candidates.sort((a, b) => rank(order, a.provider) - rank(order, b.provider));
      const manual = overrideMap.get(key);
      const selected = (manual && candidates.find((c) => c.provider === manual)) || candidates[0];
      const method = manual && selected.provider === manual ? "manual" : candidates.length === 1 ? "single" : "priority";
      const conflict = spread(
        candidates.map((c) => c.value),
        selected.value,
      ) > (def?.tolerance ?? 0.1);

      rows.push({
        userId,
        day,
        metric,
        value: selected.value,
        unit: def?.unit ?? byProvider.get(selected.provider)![0].unit,
        selectedProvider: selected.provider,
        selectedObservationId: selected.observationId,
        method,
        candidates,
        hasConflict: conflict,
      });
      written++;
    }
    for (let j = 0; j < rows.length; j += 500) await q.insert(dailyMetrics).values(rows.slice(j, j + 500));
  }
  return written;
}

// ---------------------------------------------------------------------------
// Activity grouping
// ---------------------------------------------------------------------------

const MIN_OVERLAP = 0.5;

function overlapRatio(a: { startTime: Date; endTime: Date }, b: { startTime: Date; endTime: Date }): number {
  const overlap = Math.min(a.endTime.getTime(), b.endTime.getTime()) - Math.max(a.startTime.getTime(), b.startTime.getTime());
  if (overlap <= 0) return 0;
  const shorter = Math.min(a.endTime.getTime() - a.startTime.getTime(), b.endTime.getTime() - b.startTime.getTime()) || 1;
  return overlap / shorter;
}

export async function groupActivity(userId: string, activityId: string): Promise<string> {
  return withUserLock(userId, (q) => groupActivityImpl(q, userId, activityId));
}

async function groupActivityImpl(q: Tx, userId: string, activityId: string): Promise<string> {
  const [act] = await q.select().from(activities).where(eq(activities.id, activityId));
  if (!act) throw new Error(`activity ${activityId} not found`);

  const neighbours = await q
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.userId, userId),
        ne(activities.id, act.id),
        lt(activities.startTime, act.endTime),
        gt(activities.endTime, act.startTime),
      ),
    );
  // An activity the user split out by hand stays on its own, and nothing is merged into it.
  const matches = (act.manualSplit ? [] : neighbours).filter(
    (n) => !n.manualSplit && n.provider !== act.provider && sportsCompatible(n.sport as Sport, act.sport as Sport) && overlapRatio(n, act) >= MIN_OVERLAP,
  );

  const groupIds = [...new Set(matches.map((m) => m.groupId).filter((g): g is string => !!g))];
  let groupId = act.groupId && !groupIds.includes(act.groupId) ? null : act.groupId;
  groupId = groupId ?? groupIds[0] ?? null;

  if (!groupId) {
    const [g] = await q
      .insert(activityGroups)
      .values({ userId, sport: act.sport, name: act.name, startTime: act.startTime, endTime: act.endTime })
      .returning({ id: activityGroups.id });
    groupId = g.id;
  }

  // Merge every touched group into one.
  const toMerge = groupIds.filter((g) => g !== groupId);
  const memberIds = [act.id, ...matches.map((m) => m.id)];
  await q
    .update(activities)
    .set({ groupId })
    .where(or(inArray(activities.id, memberIds), toMerge.length ? inArray(activities.groupId, toMerge) : undefined));
  if (toMerge.length) await q.delete(activityGroups).where(inArray(activityGroups.id, toMerge));

  // The activity may have left an older group (e.g. its times were corrected).
  if (act.groupId && act.groupId !== groupId) await recomputeGroupImpl(q, userId, act.groupId);
  await recomputeGroupImpl(q, userId, groupId);
  return groupId;
}

export async function recomputeGroup(userId: string, groupId: string): Promise<void> {
  return withUserLock(userId, (q) => recomputeGroupImpl(q, userId, groupId));
}

async function recomputeGroupImpl(q: Tx, userId: string, groupId: string): Promise<void> {
  const [group] = await q.select().from(activityGroups).where(eq(activityGroups.id, groupId));
  if (!group) return;
  const members = await q.select().from(activities).where(eq(activities.groupId, groupId));
  if (members.length === 0) {
    await q.delete(activityGroups).where(eq(activityGroups.id, groupId));
    return;
  }

  const prio = await loadPriorities(userId, q);
  const pinned = members.find((m) => m.id === group.manualPrimaryActivityId);
  const merged: Record<string, FieldSource> = {};
  let conflict = false;

  for (const field of ACTIVITY_FIELDS) {
    const withValue = members.filter((m) => m[field] != null);
    if (withValue.length === 0) continue;
    const order = activityOrder(field, prio);
    withValue.sort((a, b) => rankActivity(order, a) - rankActivity(order, b));
    const pick = pinned && pinned[field] != null ? pinned : withValue[0];
    merged[field] = { value: pick[field] as number | string, provider: pick.provider, activityId: pick.id };

    const tol = ACTIVITY_TOLERANCE[field];
    if (tol && withValue.length > 1) {
      const nums = withValue.map((m) => Number(m[field]));
      if (spread(nums, Number(pick[field])) > tol) conflict = true;
    }
  }

  const metaOrder = activityOrder("name", prio);
  const primary = pinned ?? [...members].sort((a, b) => rankActivity(metaOrder, a) - rankActivity(metaOrder, b))[0];

  await q
    .update(activityGroups)
    .set({
      sport: (merged.sport?.value as string) ?? primary.sport,
      name: (merged.name?.value as string) ?? primary.name,
      startTime: new Date(Math.min(...members.map((m) => m.startTime.getTime()))),
      endTime: new Date(Math.max(...members.map((m) => m.endTime.getTime()))),
      primaryActivityId: primary.id,
      merged,
      memberCount: members.length,
      hasConflict: conflict,
      updatedAt: new Date(),
    })
    .where(eq(activityGroups.id, groupId));
}

// Re-run resolution for everything a user owns (after priorities change).
export async function resolveAll(userId: string): Promise<void> {
  const days = await db
    .selectDistinct({ day: observations.day })
    .from(observations)
    .where(and(eq(observations.userId, userId), ne(observations.granularity, "sample")));
  await resolveDays(
    userId,
    days.map((d) => d.day).filter((d): d is string => !!d),
  );
  const groups = await db.select({ id: activityGroups.id }).from(activityGroups).where(eq(activityGroups.userId, userId));
  for (const g of groups) await recomputeGroup(userId, g.id);
  const orphans = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.userId, userId), isNull(activities.groupId)));
  for (const a of orphans) await groupActivity(userId, a.id);
}
