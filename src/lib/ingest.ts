// Write path shared by every source (OAuth adapters, webhooks, the mobile
// app's /api/ingest). All writes are idempotent upserts keyed by
// (user, provider, externalId), so re-syncing never duplicates data.

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { activities, activityStreams, devices, observations, rawRecords } from "./db/schema";
import { METRIC_MAP } from "./metrics";
import { groupActivity, resolveDays } from "./resolve";
import { toSport, type Sport } from "./sports";

export type DeviceInput = { brand?: string | null; model: string; kind?: string | null };

export type ObservationInput = {
  metric: string;
  value: number | null | undefined;
  granularity: "daily" | "session" | "sample";
  externalId: string;
  day?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
  unit?: string;
  origin?: string | null;
  device?: DeviceInput | null;
  rawRecordId?: string | null;
};

export type ActivityInput = {
  externalId: string;
  name?: string | null;
  sport?: Sport;
  sportRaw?: string | null;
  startTime: Date;
  endTime: Date;
  utcOffsetMinutes?: number | null;
  movingSeconds?: number | null;
  elapsedSeconds?: number | null;
  distanceM?: number | null;
  elevationGainM?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  avgPower?: number | null;
  normalizedPower?: number | null;
  avgCadence?: number | null;
  avgSpeed?: number | null;
  calories?: number | null;
  strain?: number | null;
  trainingLoad?: number | null;
  origin?: string | null;
  device?: DeviceInput | null;
  rawRecordId?: string | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
// For integer columns: upstream durations often carry fractions (e.g. WHOOP's 3359.07 s).
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

export class Ingestor {
  readonly stats = { raw: 0, observations: 0, activities: 0, streams: 0, skipped: 0 };
  private days = new Set<string>();
  private activityIds = new Set<string>();
  private deviceCache = new Map<string, string>();

  constructor(
    readonly userId: string,
    readonly provider: string,
  ) {}

  async raw(resourceType: string, externalId: string | number, payload: unknown): Promise<string> {
    const json = JSON.stringify(payload);
    const hash = createHash("sha256").update(json).digest("hex");
    const [row] = await db
      .insert(rawRecords)
      .values({ userId: this.userId, provider: this.provider, resourceType, externalId: String(externalId), payload, payloadHash: hash })
      .onConflictDoUpdate({
        target: [rawRecords.userId, rawRecords.provider, rawRecords.resourceType, rawRecords.externalId],
        set: { payload, payloadHash: hash, fetchedAt: new Date() },
      })
      .returning({ id: rawRecords.id });
    this.stats.raw++;
    return row.id;
  }

  async device(d: DeviceInput | null | undefined): Promise<string | null> {
    if (!d?.model) return null;
    const key = `${(d.brand ?? this.provider).toLowerCase()}:${d.model.toLowerCase().trim()}`;
    const cached = this.deviceCache.get(key);
    if (cached) return cached;
    const [row] = await db
      .insert(devices)
      .values({ userId: this.userId, key, brand: d.brand ?? null, model: d.model, kind: d.kind ?? null })
      .onConflictDoUpdate({ target: [devices.userId, devices.key], set: { lastSeenAt: new Date() } })
      .returning({ id: devices.id });
    this.deviceCache.set(key, row.id);
    return row.id;
  }

  async observation(o: ObservationInput): Promise<void> {
    const value = num(o.value);
    if (value == null) {
      this.stats.skipped++;
      return;
    }
    const def = METRIC_MAP[o.metric];
    if (!def) throw new Error(`Unknown metric ${o.metric}`);
    const deviceId = await this.device(o.device);
    const values = {
      userId: this.userId,
      metric: o.metric,
      value,
      unit: o.unit ?? def.unit,
      granularity: o.granularity,
      day: o.day ?? null,
      startTime: o.startTime ?? null,
      endTime: o.endTime ?? null,
      provider: this.provider,
      origin: o.origin ?? null,
      deviceId,
      externalId: o.externalId,
      rawRecordId: o.rawRecordId ?? null,
    };
    await db
      .insert(observations)
      .values(values)
      .onConflictDoUpdate({
        target: [observations.userId, observations.provider, observations.metric, observations.externalId],
        set: { ...values, updatedAt: new Date() },
      });
    if (o.day) this.days.add(o.day);
    this.stats.observations++;
  }

  async activity(a: ActivityInput): Promise<string> {
    const deviceId = await this.device(a.device);
    const values = {
      userId: this.userId,
      provider: this.provider,
      externalId: a.externalId,
      origin: a.origin ?? null,
      deviceId,
      name: a.name ?? null,
      sport: a.sport ?? toSport(a.sportRaw),
      sportRaw: a.sportRaw ?? null,
      startTime: a.startTime,
      endTime: a.endTime,
      utcOffsetMinutes: int(a.utcOffsetMinutes),
      movingSeconds: int(a.movingSeconds),
      elapsedSeconds: int(a.elapsedSeconds),
      distanceM: num(a.distanceM),
      elevationGainM: num(a.elevationGainM),
      avgHr: num(a.avgHr),
      maxHr: num(a.maxHr),
      avgPower: num(a.avgPower),
      normalizedPower: num(a.normalizedPower),
      avgCadence: num(a.avgCadence),
      avgSpeed: num(a.avgSpeed),
      calories: num(a.calories),
      strain: num(a.strain),
      trainingLoad: num(a.trainingLoad),
      rawRecordId: a.rawRecordId ?? null,
    };
    const [row] = await db
      .insert(activities)
      .values(values)
      .onConflictDoUpdate({
        target: [activities.userId, activities.provider, activities.externalId],
        set: { ...values, updatedAt: new Date() },
      })
      .returning({ id: activities.id });
    this.activityIds.add(row.id);
    this.stats.activities++;
    return row.id;
  }

  async streams(activityId: string, streams: Record<string, number[] | [number, number][]>): Promise<void> {
    await db
      .insert(activityStreams)
      .values({ activityId, streams })
      .onConflictDoUpdate({ target: activityStreams.activityId, set: { streams } });
    await db.update(activities).set({ hasStreams: true }).where(eq(activities.id, activityId));
    this.stats.streams++;
  }

  async hasStreams(externalId: string): Promise<boolean> {
    const [row] = await db
      .select({ has: activities.hasStreams })
      .from(activities)
      .where(and(eq(activities.userId, this.userId), eq(activities.provider, this.provider), eq(activities.externalId, externalId)));
    return !!row?.has;
  }

  async deleteActivity(externalId: string): Promise<void> {
    const [row] = await db
      .delete(activities)
      .where(and(eq(activities.userId, this.userId), eq(activities.provider, this.provider), eq(activities.externalId, externalId)))
      .returning({ groupId: activities.groupId });
    if (row?.groupId) {
      const { recomputeGroup } = await import("./resolve");
      await recomputeGroup(this.userId, row.groupId);
    }
  }

  async deleteObservations(externalIdPrefix: string): Promise<void> {
    const rows = await db
      .delete(observations)
      .where(
        and(
          eq(observations.userId, this.userId),
          eq(observations.provider, this.provider),
          sql`${observations.externalId} like ${externalIdPrefix + "%"}`,
        ),
      )
      .returning({ day: observations.day });
    rows.forEach((r) => r.day && this.days.add(r.day));
  }

  // Re-resolve every day and activity group touched during this run.
  async finalize(): Promise<void> {
    await resolveDays(this.userId, [...this.days]);
    for (const id of this.activityIds) await groupActivity(this.userId, id);
  }
}
