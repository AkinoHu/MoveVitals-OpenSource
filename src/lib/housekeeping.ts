// Periodic cleanup of short-lived rows. Correctness never depends on it (every
// reader checks expiry itself); it only keeps the tables small.
import { and, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import { apiTokens, emailTokens, loginStates, oauthStates, sessions, webhookEvents } from "./db/schema";
import { sweepLeases, withLease } from "./locks";
import { sweepRateLimits } from "./ratelimit";

const ago = (interval: string) => sql`now() - ${sql.raw(`interval '${interval}'`)}`;

export async function runHousekeeping(): Promise<Record<string, number>> {
  const res = await withLease("housekeeping", async () => {
    const n = async (q: Promise<unknown[]>) => (await q).length;
    const out = {
      sessions: await n(db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`)).returning({ id: sessions.id })),
      oauthStates: await n(db.delete(oauthStates).where(lt(oauthStates.createdAt, ago("1 hour"))).returning({ s: oauthStates.state })),
      loginStates: await n(db.delete(loginStates).where(lt(loginStates.createdAt, ago("1 hour"))).returning({ s: loginStates.state })),
      emailTokens: await n(db.delete(emailTokens).where(lt(emailTokens.expiresAt, ago("1 day"))).returning({ k: emailTokens.expiresAt })),
      apiTokens: await n(db.delete(apiTokens).where(and(isNotNull(apiTokens.expiresAt), lt(apiTokens.expiresAt, ago("1 day")))).returning({ k: apiTokens.expiresAt })),
      // Finished webhook events are only kept for debugging.
      webhookEvents: await n(
        db
          .delete(webhookEvents)
          .where(and(inArray(webhookEvents.status, ["done", "ignored", "error"]), or(lt(webhookEvents.processedAt, ago("14 days")), lt(webhookEvents.receivedAt, ago("30 days")))))
          .returning({ k: webhookEvents.receivedAt }),
      ),
    };
    await sweepRateLimits();
    await sweepLeases();
    return out;
  });
  return res.acquired ? res.value : {};
}

/** True at most once per interval per process. */
let last = 0;
export function housekeepingDue(everyMs = 3600_000): boolean {
  if (Date.now() - last < everyMs) return false;
  last = Date.now();
  return true;
}
