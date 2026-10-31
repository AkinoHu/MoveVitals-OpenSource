import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { makeUser, setupDb } from "./helpers";

describe("resolve + ingest", () => {
  before(async () => {
    await setupDb();
  });

  it("ingest is idempotent and resolution picks by priority", async () => {
    const { Ingestor } = await import("../src/lib/ingest");
    const { db } = await import("../src/lib/db");
    const { dailyMetrics, observations } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const u = await makeUser();
    for (let run = 0; run < 2; run++) {
      const entries: [string, number][] = [["whoop", 50], ["garmin", 58]];
      for (const [provider, value] of entries) {
        const ing = new Ingestor(u.id, provider);
        await ing.observation({ metric: "resting_hr", value, granularity: "daily", externalId: "d1", day: "2026-01-01" });
        await ing.finalize();
      }
    }
    assert.equal((await db.select().from(observations).where(eq(observations.userId, u.id))).length, 2);
    const [row] = await db.select().from(dailyMetrics).where(eq(dailyMetrics.userId, u.id));
    assert.equal(row.selectedProvider, "whoop"); // heart category default: whoop first
    assert.equal(row.hasConflict, true);
    assert.equal(row.candidates.length, 2);
  });

  it("overlapping activities from two providers merge, concurrently-safe, and manual splits stay split", async () => {
    const { Ingestor } = await import("../src/lib/ingest");
    const { db } = await import("../src/lib/db");
    const { activities, activityGroups } = await import("../src/lib/db/schema");
    const { groupActivity, recomputeGroup } = await import("../src/lib/resolve");
    const { eq } = await import("drizzle-orm");
    const u = await makeUser();
    const start = new Date("2026-02-01T08:00:00Z");
    const end = new Date("2026-02-01T09:00:00Z");
    const a = await new Ingestor(u.id, "garmin").activity({ externalId: "g1", sport: "run", startTime: start, endTime: end, distanceM: 10000 });
    const b = await new Ingestor(u.id, "strava").activity({ externalId: "s1", sport: "run", startTime: start, endTime: end, distanceM: 10050 });
    await Promise.all([groupActivity(u.id, a), groupActivity(u.id, b)]);
    const rows = await db.select().from(activities).where(eq(activities.userId, u.id));
    assert.equal(new Set(rows.map((r) => r.groupId)).size, 1);
    assert.equal((await db.select().from(activityGroups).where(eq(activityGroups.userId, u.id))).length, 1);

    // The user splits b out; re-grouping must not merge it back.
    const [g] = await db.insert(activityGroups).values({ userId: u.id, sport: "run", startTime: start, endTime: end, manualPrimaryActivityId: b }).returning();
    await db.update(activities).set({ groupId: g.id, manualSplit: true }).where(eq(activities.id, b));
    await recomputeGroup(u.id, g.id);
    await groupActivity(u.id, a);
    await groupActivity(u.id, b);
    const after = await db.select().from(activities).where(eq(activities.userId, u.id));
    assert.equal(new Set(after.map((r) => r.groupId)).size, 2);
  });
});
