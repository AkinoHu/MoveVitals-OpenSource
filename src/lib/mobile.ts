// Shared helpers for the iOS app API (/api/mobile/*). The app authenticates
// with a per-device bearer token issued at sign-in (api_tokens.kind = "app").

import { eq } from "drizzle-orm";
import { userFromApiToken } from "./auth";
import { db } from "./db";
import { authAccounts, connections, users } from "./db/schema";

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

export async function mobileUserId(req: Request): Promise<string | null> {
  return userFromApiToken(req);
}

export async function profile(userId: string) {
  const [u] = await db
    .select({ id: users.id, email: users.email, name: users.name, timezone: users.timezone, units: users.units, cloudSync: users.cloudSync, hasPassword: users.passwordHash, avatarUpdatedAt: users.avatarUpdatedAt, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!u) return null;
  const [conns, accounts] = await Promise.all([
    db.select({ provider: connections.provider, status: connections.status, lastSyncAt: connections.lastSyncAt }).from(connections).where(eq(connections.userId, userId)),
    db.select({ provider: authAccounts.provider }).from(authAccounts).where(eq(authAccounts.userId, userId)),
  ]);
  return { ...u, hasPassword: !!u.hasPassword, signInMethods: [...(u.hasPassword ? ["password"] : []), ...accounts.map((a) => a.provider)], connections: conns };
}
