// Account lookup shared by web sign-in, mobile sign-in and Google sign-in.

import { and, desc, eq, isNull } from "drizzle-orm";
import { APP_TOKEN_DAYS, createApiTokenValue } from "./auth";
import { clearHits, hit, isLimited } from "./ratelimit";
import { hashPassword, verifyPassword } from "./crypto";
import { db } from "./db";
import { apiTokens, authAccounts, sessions, users } from "./db/schema";

export const normaliseEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

// Brute-force guards, stored in Postgres so they hold across replicas and restarts:
// 10 failed attempts per email and 30 per IP, each per 15 minutes.
const WINDOW = 15 * 60_000;
const emailKey = (email: string) => `login:email:${normaliseEmail(email)}`;
const ipKey = (ip: string) => `login:ip:${ip}`;

export async function tooManyAttempts(email: string, ip = "unknown"): Promise<boolean> {
  const [byEmail, byIp] = await Promise.all([isLimited(emailKey(email), 10, WINDOW), isLimited(ipKey(ip), 30, WINDOW)]);
  return byEmail || byIp;
}

export async function verifyCredentials(email: string, password: string, ip = "unknown"): Promise<string | null> {
  if (await tooManyAttempts(email, ip)) return null;
  const id = await checkPassword(email, password);
  if (id) await clearHits(emailKey(email));
  else await Promise.all([hit(emailKey(email), 10, WINDOW), hit(ipKey(ip), 30, WINDOW)]);
  return id;
}

/** Throttles account creation per IP (web and mobile). True when allowed. */
export const signupAllowed = (ip: string) => hit(`signup:ip:${ip}`, 5, 3600_000);

// Used to spend the same time on unknown emails as on wrong passwords.
let dummyHash: Promise<string> | undefined;

async function checkPassword(email: string, password: string): Promise<string | null> {
  const [user] = await db.select({ id: users.id, hash: users.passwordHash }).from(users).where(eq(users.email, normaliseEmail(email)));
  // Accounts created through Google have no password.
  if (!user?.hash) {
    dummyHash ??= hashPassword("mv-dummy-password");
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, user.hash))) return null;
  await touchLogin(user.id);
  return user.id;
}

export async function createPasswordUser(email: string, password: string, name: string | null): Promise<string | null> {
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, normaliseEmail(email)));
  if (exists) return null;
  const [user] = await db
    .insert(users)
    .values({ email: normaliseEmail(email), name, passwordHash: await hashPassword(password), lastLoginAt: new Date() })
    .returning({ id: users.id });
  return user.id;
}

export async function touchLogin(userId: string) {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

export type ExternalIdentity = { provider: "google" | "apple"; subject: string; email: string | null; emailVerified: boolean; name: string | null };

export type IdentityResult = { userId: string; created: boolean } | { error: "signup_closed" | "no_email" | "already_linked" };

// Resolve an external identity to a user: an existing link, else an account
// with the same verified email (linked on the spot), else a new account.
export async function signInWithIdentity(id: ExternalIdentity, linkUserId?: string | null): Promise<IdentityResult> {
  const [linked] = await db
    .select({ userId: authAccounts.userId })
    .from(authAccounts)
    .where(and(eq(authAccounts.provider, id.provider), eq(authAccounts.subject, id.subject)));

  if (linkUserId) {
    if (linked && linked.userId !== linkUserId) return { error: "already_linked" };
    if (!linked) {
      await db.insert(authAccounts).values({ userId: linkUserId, provider: id.provider, subject: id.subject, email: id.email });
      // The provider vouches for this address: if it is the account's own email, that verifies it.
      if (id.emailVerified && id.email) {
        await db
          .update(users)
          .set({ emailVerifiedAt: new Date() })
          .where(and(eq(users.id, linkUserId), eq(users.email, normaliseEmail(id.email)), isNull(users.emailVerifiedAt)));
      }
    }
    return { userId: linkUserId, created: false };
  }
  if (linked) {
    await touchLogin(linked.userId);
    return { userId: linked.userId, created: false };
  }

  if (!id.email || !id.emailVerified) return { error: "no_email" };
  const email = normaliseEmail(id.email);
  const [byEmail] = await db.select({ id: users.id, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.email, email));
  let userId = byEmail?.id;
  let created = false;
  if (!userId) {
    if (process.env.ALLOW_SIGNUP === "false") return { error: "signup_closed" };
    [{ id: userId }] = await db.insert(users).values({ email, name: id.name, emailVerifiedAt: new Date() }).returning({ id: users.id });
    created = true;
  } else {
    // Someone may have registered this address with a password before the owner
    // proved they control it (pre-account takeover). Whoever holds the credentials
    // of such an unverified account must not keep them once the real owner signs in.
    if (!byEmail.verifiedAt) await resetUnverifiedAccount(userId);
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  }
  await db.insert(authAccounts).values({ userId, provider: id.provider, subject: id.subject, email }).onConflictDoNothing();
  await touchLogin(userId);
  return { userId, created };
}

/**
 * Drops every credential on an account whose email was never verified: the
 * password, all sessions, API/app tokens and any other linked sign-in methods.
 * Data (activities, connections) is kept; the account is simply re-keyed to the
 * identity that just proved ownership of the address.
 */
export async function resetUnverifiedAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: null }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(apiTokens).where(eq(apiTokens.userId, userId));
    await tx.delete(authAccounts).where(eq(authAccounts.userId, userId));
  });
}

const MAX_APP_TOKENS = 10;

// Token for the iOS app: a revocable API token tied to one device.
export async function issueAppToken(userId: string, deviceName: string): Promise<string> {
  const { token, hash } = createApiTokenValue();
  await db.insert(apiTokens).values({
    userId,
    name: deviceName.slice(0, 80) || "MoveVitals app",
    kind: "app",
    tokenHash: hash,
    expiresAt: new Date(Date.now() + APP_TOKEN_DAYS * 86400_000),
  });
  // Cap the number of devices: drop the oldest app tokens beyond the limit.
  const all = await db.select({ id: apiTokens.id }).from(apiTokens).where(and(eq(apiTokens.userId, userId), eq(apiTokens.kind, "app"))).orderBy(desc(apiTokens.createdAt));
  for (const old of all.slice(MAX_APP_TOKENS)) await db.delete(apiTokens).where(eq(apiTokens.id, old.id));
  return token;
}
