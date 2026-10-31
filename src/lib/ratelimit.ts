// Fixed-window rate limiting backed by Postgres, so the limits hold across
// restarts, replicas and the web/worker split (an in-memory Map does not).

import { sql } from "drizzle-orm";
import { db } from "./db";
import { rateLimits } from "./db/schema";

/**
 * Counts one hit against `key`. Returns true when the caller is still within
 * `limit` hits per `windowMs`, false when it should be rejected.
 */
export async function hit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const expired = sql`${rateLimits.windowStart} < now() - (${windowMs}::double precision * interval '1 millisecond')`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  return row.count <= limit;
}

/** Read-only check: true when `key` has already used up `limit` hits in the current window. */
export async function isLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(sql`${rateLimits.key} = ${key} and ${rateLimits.windowStart} >= now() - (${windowMs}::double precision * interval '1 millisecond')`);
  return (row?.count ?? 0) >= limit;
}

/** Forgets a key (e.g. after a successful login). */
export async function clearHits(key: string): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.key} = ${key}`);
}

/** Housekeeping: drops counters whose window ended long ago. */
export async function sweepRateLimits(): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} < now() - interval '1 day'`);
}
