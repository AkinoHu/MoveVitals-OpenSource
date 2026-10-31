// Email ownership proof: a single-use link mailed to the address on the account.

import { and, eq, gt } from "drizzle-orm";
import { randomToken, sha256 } from "./crypto";
import { db } from "./db";
import { emailTokens, users } from "./db/schema";
import { mailEnabled, sendMail } from "./mail";
import { hit } from "./ratelimit";
import { appUrl } from "./providers";

const TTL_MS = 24 * 3600_000;

/** Mails a fresh verification link. Returns false when mail is off, throttled or the user is already verified. */
export async function sendVerificationEmail(userId: string): Promise<boolean> {
  if (!mailEnabled()) return false;
  const [u] = await db.select({ email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  if (!u || u.verified) return false;
  if (!(await hit(`verify-email:${userId}`, 3, 3600_000))) return false;
  const token = randomToken(32);
  await db.delete(emailTokens).where(eq(emailTokens.userId, userId));
  await db.insert(emailTokens).values({ tokenHash: sha256(token), userId, email: u.email, expiresAt: new Date(Date.now() + TTL_MS) });
  return sendMail(
    u.email,
    "Confirm your email for MoveVitals",
    `Confirm that this is your email address by opening the link below (valid for 24 hours):\n\n${appUrl()}/api/auth/verify-email?token=${token}\n\nIf you did not create a MoveVitals account you can ignore this message.`,
  );
}

/** Consumes a token; returns the verified user id or null. */
export async function consumeVerificationToken(token: string): Promise<string | null> {
  const [row] = await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.tokenHash, sha256(token)), gt(emailTokens.expiresAt, new Date())))
    .returning();
  if (!row) return null;
  const [u] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, row.userId), eq(users.email, row.email))) // the address must not have changed since
    .returning({ id: users.id });
  return u?.id ?? null;
}
