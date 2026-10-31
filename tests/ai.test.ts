import assert from "node:assert/strict";
import http from "node:http";
import { before, describe, it } from "node:test";
import { makeUser, setupDb } from "./helpers";

describe("AI endpoint safety", () => {
  it("classifies private, loopback, link-local and mapped addresses", async () => {
    const { isPrivateIp } = await import("../src/lib/safe-fetch");
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.9.9", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "224.0.0.1"]) assert.equal(isPrivateIp(ip), true, ip);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "172.32.0.1"]) assert.equal(isPrivateIp(ip), false, ip);
  });

  it("rejects non-https, credentials and internal hosts", async () => {
    delete process.env.AI_ALLOW_PRIVATE_URLS;
    const { checkUrl } = await import("../src/lib/safe-fetch");
    for (const u of ["http://api.example.com/v1", "https://user:pw@api.example.com", "https://localhost/v1", "https://127.0.0.1/v1", "https://[::1]/v1", "https://169.254.169.254/latest", "https://db.internal/", "ftp://x.com", "nope"]) assert.throws(() => checkUrl(u), u);
    assert.doesNotThrow(() => checkUrl("https://api.openai.com/v1"));
  });

  it("refuses hosts that resolve to loopback (checked at connect time)", async () => {
    delete process.env.AI_ALLOW_PRIVATE_URLS;
    const { safeJsonPost } = await import("../src/lib/safe-fetch");
    await assert.rejects(safeJsonPost("https://localtest.me/v1/x", {}, "{}", { timeoutMs: 3000 }));
  });

  it("self-host opt-in allows a local server, caps size and handles non-JSON", async () => {
    process.env.AI_ALLOW_PRIVATE_URLS = "1";
    const { safeJsonPost } = await import("../src/lib/safe-fetch");
    const srv = http.createServer((req, res) => {
      if (req.url === "/big") return void res.end("x".repeat(200_000));
      if (req.url === "/redirect") return void res.writeHead(302, { location: "http://127.0.0.1:1/" }).end();
      if (req.url === "/html") return void res.end("<html>");
      res.setHeader("content-type", "application/json").end('{"ok":true}');
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      assert.deepEqual((await safeJsonPost(`${base}/ok`, {}, "{}")).json, { ok: true });
      assert.equal((await safeJsonPost(`${base}/html`, {}, "{}")).json, null);
      await assert.rejects(safeJsonPost(`${base}/big`, {}, "{}", { maxBytes: 1000 }), /too large/);
      await assert.rejects(safeJsonPost(`${base}/redirect`, {}, "{}"), /redirect/);
    } finally {
      srv.close();
      delete process.env.AI_ALLOW_PRIVATE_URLS;
    }
  });
});

describe("AI context filtering", () => {
  before(async () => {
    await setupDb();
  });

  it("respects source restrictions and the profile / names / labs toggles", async () => {
    const { db } = await import("../src/lib/db");
    const { activityGroups, userAttributes, labResults } = await import("../src/lib/db/schema");
    const { buildContext } = await import("../src/lib/ai");
    const u = await makeUser();
    const start = new Date(Date.now() - 86400_000);
    await db.insert(activityGroups).values({
      userId: u.id,
      sport: "run",
      name: "Secret Strava Title",
      startTime: start,
      endTime: new Date(start.getTime() + 3600_000),
      merged: {
        name: { value: "Secret Strava Title", provider: "strava", activityId: "a" },
        sport: { value: "run", provider: "strava", activityId: "a" },
        distanceM: { value: 5000, provider: "garmin", activityId: "b" },
      },
    });
    await db.insert(userAttributes).values({ userId: u.id, key: "max_hr", value: "190" });
    await db.insert(labResults).values({ userId: u.id, marker: "ferritin", value: 55, unit: "ng/mL", takenOn: "2026-01-01", source: "manual" });

    const ctx = await buildContext(u.id, "UTC", 7, { includeProfile: false, includeLabs: false, includeNames: true });
    assert.ok(!ctx.includes("Secret Strava Title"), "restricted-source title must not leak");
    assert.ok(!/\brun\b/i.test(ctx.split("# Workouts")[1] ?? ""), "restricted-source sport must not leak");
    assert.ok(ctx.includes("distanceM=5000(Garmin Connect)"));
    assert.ok(!ctx.includes("max HR") && !ctx.includes("ferritin"));

    const full = await buildContext(u.id, "UTC", 7, { includeProfile: true, includeLabs: true, includeNames: true, allowedProviders: ["strava", "garmin"] });
    assert.ok(full.includes("Secret Strava Title") && full.includes("max HR 190") && full.includes("ferritin"));
    const noNames = await buildContext(u.id, "UTC", 7, { includeNames: false, allowedProviders: ["strava", "garmin"] });
    assert.ok(!noNames.includes("Secret Strava Title"));
  });
});
