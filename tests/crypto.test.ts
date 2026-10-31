import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "./helpers";
import { decrypt, deriveKey, encrypt, hashPassword, hmac, pkceChallenge, safeEqual, verifyPassword } from "../src/lib/crypto";

describe("crypto", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("hello ✓");
    const b = encrypt("hello ✓");
    assert.notEqual(a, b);
    assert.equal(decrypt(a), "hello ✓");
    assert.equal(decrypt(b), "hello ✓");
  });

  it("rejects tampered or unknown-version ciphertext", () => {
    const [v, iv, tag, data] = encrypt("secret").split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    assert.throws(() => decrypt([v, iv, tag, flipped.toString("base64")].join(".")));
    assert.throws(() => decrypt(["v9", iv, tag, data].join(".")), /Unknown ciphertext version/);
  });

  it("hashes passwords with a per-hash salt and verifies them", async () => {
    const h = await hashPassword("correct horse");
    assert.notEqual(h, await hashPassword("correct horse"));
    assert.equal(await verifyPassword("correct horse", h), true);
    assert.equal(await verifyPassword("wrong", h), false);
    assert.equal(await verifyPassword("x", "plain-text"), false);
  });

  it("derives independent keys per purpose", () => {
    assert.equal(deriveKey("a").length, 32);
    assert.deepEqual(deriveKey("a"), deriveKey("a"));
    assert.notDeepEqual(deriveKey("a"), deriveKey("b"));
  });

  it("compares strings in constant time regardless of length, and matches known vectors", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
    // RFC 7636 appendix B
    assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    // RFC 4231 test case 2
    assert.equal(hmac("sha256", "Jefe", "what do ya want for nothing?", "hex"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
});
