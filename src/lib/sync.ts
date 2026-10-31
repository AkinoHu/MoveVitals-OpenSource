// Sync engine: runs a provider adapter for one connection, handling token
// refresh, run bookkeeping and post-ingest conflict resolution.

import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { decryptOpt, encrypt, encryptOpt } from "./crypto";
import { db } from "./db";
import { activities, connections, syncRuns, users, webhookEvents } from "./db/schema";
import { recomputeGroup } from "./resolve";
import { toSport } from "./sports";
import { Ingestor } from "./ingest";
import { withLease } from "./locks";
import { credentialsFor, getAdapter } from "./providers";
import { CATALOG_MAP } from "./providers/catalog";
import { fetchJson, redact } from "./providers/oauth";
import { deleteProviderData } from "./provider-data";
import { ProviderError, type Connection, type ProviderAdapter } from "./providers/types";

const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS ?? 180);
const OVERLAP_HOURS = 72; // re-fetch a little history: upstream scores change after the fact
const SYNC_LEASE_MS = 15 * 60_000;

export type Trigger = "initial" | "manual" | "schedule" | "webhook";

export type SyncResult = { skipped: true } | { skipped: false; stats: Ingestor["stats"] } | { skipped: false; error: string };

// One sync per connection at a time across ALL processes (web replicas and the
// worker): a DB lease replaces the old in-process Set, which could not see
// other processes.
export async function runSync(connectionId: string, trigger: Trigger, opts: { sinceHours?: number } = {}): Promise<SyncResult> {
  const r = await withLease(`sync:${connectionId}`, () => doSync(connectionId, trigger, opts), { ttlMs: SYNC_LEASE_MS });
  return r.acquired ? r.value : { skipped: true };
}

async function doSync(connectionId: string, trigger: Trigger, opts: { sinceHours?: number }): Promise<SyncResult> {
  const [run] = await db.insert(syncRuns).values({ connectionId, trigger }).returning({ id: syncRuns.id });

  try {
    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    if (!conn) throw new Error("connection not found");
    const adapter = getAdapter(conn.provider);
    const creds = adapter && credentialsFor(adapter);
    if (!adapter || !creds) throw new Error(`provider ${conn.provider} is not configured`);
    const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, conn.userId));

    const since = opts.sinceHours
      ? new Date(Date.now() - opts.sinceHours * 3600_000)
      : conn.lastSyncAt
        ? new Date(conn.lastSyncAt.getTime() - OVERLAP_HOURS * 3600_000)
        : new Date(Date.now() - BACKFILL_DAYS * 86400_000);

    const ingest = new Ingestor(conn.userId, conn.provider);
    const tokens = { access: decryptOpt(conn.accessTokenEnc)!, refresh: decryptOpt(conn.refreshTokenEnc), expiresAt: conn.tokenExpiresAt };

    // Providers with rotating refresh tokens invalidate the old token on use, so
    // two processes refreshing at once would lose the new pair. Refreshes are
    // serialised per connection, and whoever gets the lock second adopts the
    // tokens the first one already stored instead of refreshing again.
    const refresh = async () => {
      if (!adapter.refresh || !tokens.refresh) throw new ProviderError("token expired and cannot be refreshed; reconnect required", 401);
      const staleAccess = tokens.access;
      const r = await withLease(
        `refresh:${conn.id}`,
        async () => {
          const [fresh] = await db.select().from(connections).where(eq(connections.id, conn.id));
          if (!fresh) throw new Error("connection not found");
          const freshAccess = decryptOpt(fresh.accessTokenEnc);
          if (freshAccess && freshAccess !== staleAccess) {
            tokens.access = freshAccess;
            tokens.refresh = decryptOpt(fresh.refreshTokenEnc) ?? tokens.refresh;
            tokens.expiresAt = fresh.tokenExpiresAt;
            return;
          }
          const t = await adapter.refresh!(decryptOpt(fresh.refreshTokenEnc) ?? tokens.refresh!, creds, fresh);
          tokens.access = t.accessToken;
          tokens.refresh = t.refreshToken ?? tokens.refresh;
          tokens.expiresAt = t.expiresAt ?? null;
          await db
            .update(connections)
            .set({ accessTokenEnc: encrypt(tokens.access), refreshTokenEnc: encryptOpt(tokens.refresh), tokenExpiresAt: tokens.expiresAt, updatedAt: new Date() })
            .where(eq(connections.id, conn.id));
        },
        { ttlMs: 60_000, waitMs: 30_000 },
      );
      if (!r.acquired) throw new ProviderError("token refresh is busy, will retry", 503);
    };
    const accessToken = async () => {
      if (tokens.expiresAt && tokens.expiresAt.getTime() < Date.now() + 120_000) await refresh();
      return tokens.access;
    };
    const api = async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
      const call = async () => fetchJson<T>(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await accessToken()}` } });
      try {
        return await call();
      } catch (e) {
        if (e instanceof ProviderError && e.status === 401 && adapter.refresh) {
          await refresh();
          return call();
        }
        throw e;
      }
    };

    await adapter.sync({
      connection: conn,
      userId: conn.userId,
      creds,
      ingest,
      since,
      api,
      accessToken,
      forceRefresh: refresh,
      timezone: user?.timezone ?? "UTC",
      log: (m) => console.log(`[sync:${conn.provider}] ${m}`),
    });
    await ingest.finalize();

    await db
      .update(connections)
      .set({ lastSyncAt: new Date(), status: "active", lastError: null, updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    await db.update(syncRuns).set({ status: "ok", stats: ingest.stats, finishedAt: new Date() }).where(eq(syncRuns.id, run.id));
    return { skipped: false as const, stats: ingest.stats };
  } catch (e) {
    const message = redact((e as Error).message, 500);
    const reauth = e instanceof ProviderError && e.status === 401;
    await db
      .update(connections)
      .set({
        status: reauth ? "revoked" : "error",
        lastError: message,
        // Dead credentials are not kept around.
        ...(reauth ? { accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(connections.id, connectionId));
    const [failed] = reauth ? await db.select().from(connections).where(eq(connections.id, connectionId)) : [];
    if (failed && CATALOG_MAP[failed.provider]?.purgeOnDeauth) {
      await deleteProviderData(failed.userId, failed.provider).catch((err) => console.error("[sync] purge after deauth failed:", (err as Error).message));
    }
    await db.update(syncRuns).set({ status: "error", error: message, finishedAt: new Date() }).where(eq(syncRuns.id, run.id));
    console.error(`[sync] ${connectionId} failed:`, message);
    return { skipped: false as const, error: message };
  }
}

async function ingestPush(conn: Connection, fn: NonNullable<NonNullable<ProviderAdapter["webhook"]>["ingest"]>, data: unknown) {
  // Share the connection's lease so a push never interleaves with a running sync.
  const r = await withLease(`sync:${conn.id}`, () => ingestPushLocked(conn, fn, data), { ttlMs: SYNC_LEASE_MS, waitMs: 60_000 });
  if (!r.acquired) throw new Error("connection is busy syncing; push will be retried");
}

async function ingestPushLocked(conn: Connection, fn: NonNullable<NonNullable<ProviderAdapter["webhook"]>["ingest"]>, data: unknown) {
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, conn.userId));
  const ingest = new Ingestor(conn.userId, conn.provider);
  await fn(data, { ingest, timezone: user?.timezone ?? "UTC", log: (m) => console.log(`[push:${conn.provider}] ${m}`) });
  await ingest.finalize();
  await db.update(connections).set({ lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, conn.id));
}

// Called by the worker on an interval: sync every active connection whose
// last sync is older than `intervalMinutes`.
export async function syncDue(intervalMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - intervalMinutes * 60_000);
  const due = await db
    .select({ id: connections.id })
    .from(connections)
    // "error" connections are retried too; only "revoked" needs the user to re-authorise.
    .where(and(ne(connections.status, "revoked"), or(isNull(connections.lastSyncAt), lt(connections.lastSyncAt, cutoff))));
  for (const c of due) await runSync(c.id, "schedule");
  return due.length;
}

// Process queued webhook deliveries. Events are claimed atomically so the
// web process (via after()) and the worker never handle the same one twice.
export async function processWebhooks(limit = 50): Promise<number> {
  const pending = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "pending"))
    .orderBy(webhookEvents.receivedAt)
    .limit(limit);
  let handled = 0;
  for (const { id } of pending) {
    const [evt] = await db
      .update(webhookEvents)
      .set({ status: "processing" })
      .where(and(eq(webhookEvents.id, id), eq(webhookEvents.status, "pending")))
      .returning();
    if (!evt) continue;
    handled++;
    const payload = evt.payload as { sinceHours?: number; data?: unknown };
    const adapter = getAdapter(evt.provider);
    const conns: Connection[] = evt.externalUserId
      ? await db
          .select()
          .from(connections)
          .where(and(eq(connections.provider, evt.provider), eq(connections.externalUserId, evt.externalUserId)))
      : [];
    if (conns.length === 0) {
      await db.update(webhookEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(webhookEvents.id, evt.id));
      continue;
    }
    try {
      for (const c of conns) {
        if (payload.data !== undefined && adapter?.webhook?.ingest) {
          await ingestPush(c, adapter.webhook.ingest, payload.data);
        } else if (payload.sinceHours === 0) {
          // A deauthorisation event is not taken at face value: a sync with the
          // stored token confirms it (a 401 after refresh marks the connection
          // revoked in runSync). Only a verified revocation cleans up.
          await runSync(c.id, "webhook", { sinceHours: 48 });
        } else {
          await runSync(c.id, "webhook", { sinceHours: payload.sinceHours ?? 72 });
        }
      }
      await db.update(webhookEvents).set({ status: "done", processedAt: new Date() }).where(eq(webhookEvents.id, evt.id));
    } catch (e) {
      console.error(`[webhook:${evt.provider}] ${evt.id} failed:`, (e as Error).message);
      await db
        .update(webhookEvents)
        .set({ status: "error", error: redact((e as Error).message, 500), processedAt: new Date() })
        .where(eq(webhookEvents.id, evt.id));
    }
  }
  return handled;
}

// Re-derive canonical sports from the upstream name, e.g. after new sport
// types were added. Only rows whose sport would change are touched.
export async function remapSports(): Promise<number> {
  const rows = await db.select({ id: activities.id, sport: activities.sport, sportRaw: activities.sportRaw, userId: activities.userId, groupId: activities.groupId }).from(activities);
  let changed = 0;
  for (const r of rows) {
    if (!r.sportRaw) continue;
    const next = toSport(r.sportRaw);
    if (next === r.sport) continue;
    await db.update(activities).set({ sport: next }).where(eq(activities.id, r.id));
    if (r.groupId) await recomputeGroup(r.userId, r.groupId);
    changed++;
  }
  return changed;
}
