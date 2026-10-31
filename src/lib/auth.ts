import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { randomToken, sha256 } from "./crypto";
import { db } from "./db";
import { apiTokens, sessions, users } from "./db/schema";
import { isUnitSystem, type UnitSystem } from "./units";

const COOKIE = "mv_session";
const SESSION_DAYS = 30;
/** App tokens expire after this long without use (rolling). */
export const APP_TOKEN_DAYS = 90;

export type CurrentUser = { id: string; email: string; emailVerified: boolean; name: string | null; timezone: string; units: UnitSystem; avatarUpdatedAt: Date | null };

export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(COOKIE);
}

// Id of the signed-in session (sha256 of the cookie token), or null.
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? sha256(token) : null;
}

export const getUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, verifiedAt: users.emailVerifiedAt, name: users.name, timezone: users.timezone, units: users.units, avatarUpdatedAt: users.avatarUpdatedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  const { verifiedAt, ...rest } = row;
  return { ...rest, emailVerified: !!verifiedAt, units: isUnitSystem(row.units) ? row.units : "metric" };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

// Bearer personal API token (for the mobile app and scripts).
export async function userFromApiToken(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const [row] = await db
    .update(apiTokens)
    .set({
      lastUsedAt: new Date(),
      // App tokens roll forward while in use; personal tokens keep their own expiry (usually none).
      expiresAt: sql`case when ${apiTokens.kind} = 'app' then now() + (${APP_TOKEN_DAYS}::int * interval '1 day') else ${apiTokens.expiresAt} end`,
    })
    .where(and(eq(apiTokens.tokenHash, sha256(token)), or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date()))))
    .returning({ userId: apiTokens.userId });
  return row?.userId ?? null;
}

export function createApiTokenValue(): { token: string; hash: string } {
  const token = `mv_${randomToken(24)}`;
  return { token, hash: sha256(token) };
}

/**
 * Signs every other device out: other web sessions and all app tokens. Called
 * when the password changes, so a stolen session or token cannot outlive it.
 * `keepSessionId` is the caller's own session (null keeps none).
 */
export async function revokeOtherCredentials(userId: string, keepSessionId: string | null): Promise<void> {
  await db.delete(sessions).where(keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, userId));
  await db.delete(apiTokens).where(and(eq(apiTokens.userId, userId), eq(apiTokens.kind, "app")));
}
