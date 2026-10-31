// Cross-process leases. The web app and the worker are separate processes (and
// there may be several web replicas), so an in-memory Set cannot stop two
// syncs of one connection - or two refreshes of a rotating refresh token -
// from running at once. A lease is a row in `job_locks` with an expiry; it is
// taken with a single atomic upsert, renewed while the job runs, and expires
// by itself if the holder crashes.

import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { jobLocks } from "./db/schema";

const expiresIn = (ms: number) => sql`now() + (${ms}::double precision * interval '1 millisecond')`;

/** Tries to take the lease once. Returns the owner token, or null if it is held. */
export async function acquireLease(key: string, ttlMs: number): Promise<string | null> {
  const owner = randomUUID();
  const rows = await db
    .insert(jobLocks)
    .values({ key, owner, expiresAt: sql`${expiresIn(ttlMs)}` as unknown as Date })
    .onConflictDoUpdate({
      target: jobLocks.key,
      set: { owner, expiresAt: sql`${expiresIn(ttlMs)}` as unknown as Date },
      // Only steal the row when the previous holder's lease has lapsed.
      setWhere: lt(jobLocks.expiresAt, sql`now()`),
    })
    .returning({ owner: jobLocks.owner });
  return rows[0]?.owner === owner ? owner : null;
}

export async function renewLease(key: string, owner: string, ttlMs: number): Promise<boolean> {
  const rows = await db
    .update(jobLocks)
    .set({ expiresAt: sql`${expiresIn(ttlMs)}` as unknown as Date })
    .where(and(eq(jobLocks.key, key), eq(jobLocks.owner, owner)))
    .returning({ key: jobLocks.key });
  return rows.length > 0;
}

export async function releaseLease(key: string, owner: string): Promise<void> {
  await db.delete(jobLocks).where(and(eq(jobLocks.key, key), eq(jobLocks.owner, owner)));
}

export type LeaseOptions = {
  /** Lease lifetime; renewed every ttl/3 while the job runs. */
  ttlMs?: number;
  /** How long to keep trying before giving up (0 = try once). */
  waitMs?: number;
};

/**
 * Runs `fn` while holding the lease `key`. Returns `{ acquired: false }`
 * without running `fn` when another process holds it for the whole wait.
 */
export async function withLease<T>(key: string, fn: () => Promise<T>, opts: LeaseOptions = {}): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const deadline = Date.now() + (opts.waitMs ?? 0);
  let owner = await acquireLease(key, ttl);
  while (!owner && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
    owner = await acquireLease(key, ttl);
  }
  if (!owner) return { acquired: false };
  const beat = setInterval(() => void renewLease(key, owner!, ttl).catch(() => undefined), Math.max(1000, ttl / 3));
  beat.unref?.();
  try {
    return { acquired: true, value: await fn() };
  } finally {
    clearInterval(beat);
    await releaseLease(key, owner).catch(() => undefined);
  }
}

/** Deletes lapsed leases (housekeeping; correctness does not depend on it). */
export async function sweepLeases(): Promise<void> {
  await db.delete(jobLocks).where(lt(jobLocks.expiresAt, sql`now() - interval '1 hour'`));
}
