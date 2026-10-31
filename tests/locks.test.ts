import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { setupDb } from "./helpers";

describe("leases and rate limits", () => {
  before(async () => {
    await setupDb();
  });

  it("only one holder at a time, released leases can be retaken", async () => {
    const { acquireLease, releaseLease } = await import("../src/lib/locks");
    const a = await acquireLease("t:one", 60_000);
    assert.ok(a);
    assert.equal(await acquireLease("t:one", 60_000), null);
    await releaseLease("t:one", a);
    assert.ok(await acquireLease("t:one", 60_000));
  });

  it("an expired lease can be stolen", async () => {
    const { acquireLease } = await import("../src/lib/locks");
    assert.ok(await acquireLease("t:exp", 1));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(await acquireLease("t:exp", 60_000));
  });

  it("withLease serialises concurrent callers", async () => {
    const { withLease } = await import("../src/lib/locks");
    let active = 0;
    let max = 0;
    const job = () =>
      withLease(
        "t:serial",
        async () => {
          max = Math.max(max, ++active);
          await new Promise((r) => setTimeout(r, 40));
          active--;
        },
        { waitMs: 5000 },
      );
    const res = await Promise.all([job(), job(), job()]);
    assert.equal(max, 1);
    assert.ok(res.every((r) => r.acquired));
  });

  it("rate limit counts per window", async () => {
    const { hit } = await import("../src/lib/ratelimit");
    assert.equal(await hit("t:rl", 2, 60_000), true);
    assert.equal(await hit("t:rl", 2, 60_000), true);
    assert.equal(await hit("t:rl", 2, 60_000), false);
  });
});

describe("housekeeping", () => {
  it("removes expired rows and keeps live ones", async () => {
    const { db } = await import("../src/lib/db");
    const { sessions, oauthStates } = await import("../src/lib/db/schema");
    const { runHousekeeping } = await import("../src/lib/housekeeping");
    const { makeUser } = await import("./helpers");
    const u = await makeUser();
    await db.insert(sessions).values([
      { id: "old", userId: u.id, expiresAt: new Date(Date.now() - 1000) },
      { id: "live", userId: u.id, expiresAt: new Date(Date.now() + 3600_000) },
    ] as never);
    await db.insert(oauthStates).values({ state: "stale", userId: u.id, provider: "whoop", createdAt: new Date(Date.now() - 2 * 3600_000) });
    const out = await runHousekeeping();
    assert.ok(out.sessions >= 1 && out.oauthStates >= 1);
    const left = await db.select().from(sessions);
    assert.deepEqual(left.map((s) => s.id), ["live"]);
  });
});
