// Sign in with Apple for the iOS app: the app sends Apple's identity token
// (a JWT); we verify its signature against Apple's published keys and check
// issuer, audience (our bundle id) and expiry. No client secret is needed.

import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";
import type { ExternalIdentity } from "./accounts";

const KEYS_URL = "https://appleid.apple.com/auth/keys";
const ISSUER = "https://appleid.apple.com";
// Bundle ids allowed as audience (comma list), defaults to the iOS app.
const audiences = () => (process.env.APPLE_AUDIENCES ?? "com.movevitals.app").split(",").map((s) => s.trim());

type AppleKey = JsonWebKey & { kid: string; alg: string };
let cache: { keys: AppleKey[]; at: number } | null = null;

async function appleKeys(force = false): Promise<AppleKey[]> {
  if (!force && cache && Date.now() - cache.at < 3600_000) return cache.keys;
  const res = await fetch(KEYS_URL);
  if (!res.ok) throw new Error(`apple keys: ${res.status}`);
  cache = { keys: ((await res.json()) as { keys: AppleKey[] }).keys, at: Date.now() };
  return cache.keys;
}

const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export async function verifyAppleIdentityToken(token: string, name: string | null): Promise<ExternalIdentity> {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) throw new Error("apple: malformed token");
  const header = b64json(h) as { kid: string; alg: string };
  if (header.alg !== "RS256") throw new Error("apple: unexpected alg");
  // Apple rotates keys; refetch once if the kid is unknown.
  let key = (await appleKeys()).find((k) => k.kid === header.kid);
  if (!key) key = (await appleKeys(true)).find((k) => k.kid === header.kid);
  if (!key) throw new Error("apple: unknown key");

  const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(createPublicKey({ key, format: "jwk" }), Buffer.from(sig, "base64url"));
  if (!ok) throw new Error("apple: bad signature");

  const claims = b64json(p) as { iss: string; aud: string; sub: string; exp: number; email?: string; email_verified?: boolean | string };
  if (claims.iss !== ISSUER) throw new Error("apple: bad issuer");
  if (!audiences().includes(claims.aud)) throw new Error("apple: bad audience");
  if (claims.exp * 1000 < Date.now()) throw new Error("apple: expired");
  return {
    provider: "apple",
    subject: claims.sub,
    email: claims.email ?? null,
    // Apple only issues verified addresses (including private relay ones).
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name,
  };
}
