import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { hmac } from "../src/lib/crypto";
import { setupDb } from "./helpers";

describe("webhook authentication and parsing", () => {
  before(async () => {
    await setupDb();
  });

  it("keys are per provider, stable and checked in constant time", async () => {
    const { webhookKey, webhookKeyValid, webhookUrl } = await import("../src/lib/webhook-key");
    assert.notEqual(webhookKey("strava"), webhookKey("oura"));
    assert.equal(webhookKey("strava"), webhookKey("strava"));
    const url = webhookUrl("strava", "https://example.com/");
    assert.ok(url.startsWith("https://example.com/api/webhooks/strava?k="));
    assert.equal(webhookKeyValid("strava", new Request(url)), true);
    assert.equal(webhookKeyValid("oura", new Request(url)), false);
    assert.equal(webhookKeyValid("strava", new Request("https://example.com/api/webhooks/strava")), false);
    assert.equal(webhookKeyValid("strava", new Request("https://example.com/api/webhooks/strava?k=nope")), false);
  });

  it("unsigned providers are marked as requiring the URL key", async () => {
    const { getAdapter } = await import("../src/lib/providers");
    for (const p of ["strava", "oura", "withings", "concept2"]) assert.equal(getAdapter(p)?.webhook?.urlKey, true, p);
    for (const p of ["whoop", "polar"]) assert.notEqual(getAdapter(p)?.webhook?.urlKey, true, p);
  });

  it("Strava deauthorisation maps to a verification event, other events to a short re-sync", async () => {
    const { getAdapter } = await import("../src/lib/providers");
    const parse = getAdapter("strava")!.webhook!.parse;
    const req = new Request("https://x.test");
    const creds = { clientId: "a", clientSecret: "b" };
    const deauth = await parse(req, JSON.stringify({ object_type: "athlete", owner_id: 7, aspect_type: "update", updates: { authorized: "false" } }), creds);
    assert.deepEqual(deauth, { externalUserId: "7", sinceHours: 0 });
    const act = await parse(req, JSON.stringify({ object_type: "activity", owner_id: 7, aspect_type: "create" }), creds);
    assert.deepEqual(act, { externalUserId: "7", sinceHours: 48 });
  });

  it("Polar and WHOOP reject bad signatures and accept good ones", async () => {
    const { getAdapter } = await import("../src/lib/providers");
    process.env.POLAR_WEBHOOK_SECRET = "s3cret";
    const polar = getAdapter("polar")!.webhook!.parse;
    const body = JSON.stringify({ event: "EXERCISE", user_id: 5 });
    const good = new Request("https://x.test", { headers: { "polar-webhook-signature": hmac("sha256", "s3cret", body, "hex") } });
    assert.deepEqual(await polar(good, body, { clientId: "", clientSecret: "" }), { externalUserId: "5", sinceHours: 72 });
    const bad = new Request("https://x.test", { headers: { "polar-webhook-signature": "00" } });
    assert.equal(await polar(bad, body, { clientId: "", clientSecret: "" }), null);

    const whoop = getAdapter("whoop")!.webhook!.parse;
    const wb = JSON.stringify({ user_id: 9, type: "recovery.updated" });
    const ts = "1700000000";
    const ok = new Request("https://x.test", { headers: { "x-whoop-signature": hmac("sha256", "cs", ts + wb, "base64"), "x-whoop-signature-timestamp": ts } });
    assert.deepEqual(await whoop(ok, wb, { clientId: "id", clientSecret: "cs" }), { externalUserId: "9", sinceHours: 72 });
    assert.equal(await whoop(new Request("https://x.test"), wb, { clientId: "id", clientSecret: "cs" }), null);
  });

});

describe("error sanitising", () => {
  it("strips query strings, tokens and long secrets", async () => {
    const { redact, safeUrl } = await import("../src/lib/providers/oauth");
    assert.equal(safeUrl("https://api.example.com/v1/x?access_token=abc&y=1"), "https://api.example.com/v1/x");
    const out = redact('{"access_token":"abcdef123456","note":"see https://a.test/p?token=zzz"} Bearer abc.def.ghi ' + "A".repeat(40), 500);
    assert.ok(!out.includes("abcdef123456"));
    assert.ok(!out.includes("token=zzz"));
    assert.ok(!out.includes("abc.def.ghi"));
    assert.ok(!out.includes("A".repeat(40)));
  });
});
