import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { setupDb } from "./helpers";

describe("accounts", () => {
  before(async () => {
    await setupDb();
  });

  it("an unverified password account loses its credentials when the real owner signs in with Google", async () => {
    const { createPasswordUser, signInWithIdentity, verifyCredentials } = await import("../src/lib/accounts");
    const { db } = await import("../src/lib/db");
    const { apiTokens, sessions, users } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const { sha256 } = await import("../src/lib/crypto");

    const victim = "victim@example.com";
    const attackerId = (await createPasswordUser(victim, "attacker-password", null))!;
    await db.insert(sessions).values({ id: sha256("s"), userId: attackerId, expiresAt: new Date(Date.now() + 1e6) });
    await db.insert(apiTokens).values({ userId: attackerId, name: "x", tokenHash: sha256("t") });
    assert.equal(await verifyCredentials(victim, "attacker-password"), attackerId);

    const res = await signInWithIdentity({ provider: "google", subject: "g-1", email: victim, emailVerified: true, name: null });
    assert.deepEqual(res, { userId: attackerId, created: false });
    assert.equal(await verifyCredentials(victim, "attacker-password"), null);
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, attackerId))).length, 0);
    assert.equal((await db.select().from(apiTokens).where(eq(apiTokens.userId, attackerId))).length, 0);
    const [u] = await db.select().from(users).where(eq(users.id, attackerId));
    assert.ok(u.emailVerifiedAt);
  });

  it("a verified account keeps its password when the same email signs in with Google", async () => {
    const { createPasswordUser, signInWithIdentity, verifyCredentials } = await import("../src/lib/accounts");
    const { db } = await import("../src/lib/db");
    const { users } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const id = (await createPasswordUser("ok@example.com", "correct-horse", null))!;
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, id));
    await signInWithIdentity({ provider: "google", subject: "g-2", email: "ok@example.com", emailVerified: true, name: null });
    assert.equal(await verifyCredentials("ok@example.com", "correct-horse"), id);
  });

  it("locks out an email after 10 failures, across calls", async () => {
    const { createPasswordUser, verifyCredentials } = await import("../src/lib/accounts");
    const id = (await createPasswordUser("brute@example.com", "right-password", null))!;
    for (let i = 0; i < 10; i++) assert.equal(await verifyCredentials("brute@example.com", "wrong", "1.1.1.1"), null);
    assert.equal(await verifyCredentials("brute@example.com", "right-password", "2.2.2.2"), null);
    assert.ok(id);
  });

  it("admin requires a verified email", async () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    const { isAdmin } = await import("../src/lib/admin");
    assert.equal(isAdmin({ email: "boss@example.com", emailVerified: false }), false);
    assert.equal(isAdmin({ email: "boss@example.com", emailVerified: true }), true);
    assert.equal(isAdmin({ email: "other@example.com", emailVerified: true }), false);
  });

  it("app tokens are capped and expire", async () => {
    const { createPasswordUser, issueAppToken } = await import("../src/lib/accounts");
    const { db } = await import("../src/lib/db");
    const { apiTokens } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const id = (await createPasswordUser("dev@example.com", "password-123", null))!;
    for (let i = 0; i < 13; i++) await issueAppToken(id, `phone ${i}`);
    const rows = await db.select().from(apiTokens).where(eq(apiTokens.userId, id));
    assert.equal(rows.length, 10);
    assert.ok(rows.every((r) => r.expiresAt && r.expiresAt.getTime() > Date.now()));
  });
});

describe("oauth binding + client ip", () => {
  it("nonce cookie must match the stored hash", async () => {
    const { newNonce, nonceMatches, nonceCookieName } = await import("../src/lib/oauth-binding");
    const { nonce, nonceHash } = newNonce();
    const req = (cookie: string) => new Request("http://x/cb", { headers: { cookie } });
    assert.equal(nonceMatches(req(`${nonceCookieName("strava")}=${nonce}`), "strava", nonceHash), true);
    assert.equal(nonceMatches(req(`${nonceCookieName("strava")}=nope`), "strava", nonceHash), false);
    assert.equal(nonceMatches(req(""), "strava", nonceHash), false);
    assert.equal(nonceMatches(req(`${nonceCookieName("strava")}=${nonce}`), "strava", null), false);
  });

  it("clientIp reads from the trusted (right) side of X-Forwarded-For", async () => {
    const { clientIp } = await import("../src/lib/client-ip");
    delete process.env.CLIENT_IP_HEADER;
    delete process.env.TRUSTED_PROXY_HOPS;
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" })), "9.9.9.9");
    process.env.TRUSTED_PROXY_HOPS = "2";
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" })), "6.6.6.6");
    delete process.env.TRUSTED_PROXY_HOPS;
  });
});
