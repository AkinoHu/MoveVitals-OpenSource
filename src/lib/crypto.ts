import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

let cachedKey: Buffer | null = null;

// ENCRYPTION_KEY: 32 random bytes, base64. Generate with `openssl rand -base64 32`.
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    cachedKey = buf;
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY is required in production");
    cachedKey = createHash("sha256").update("movevitals-insecure-dev-key").digest();
  }
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(enc: string): string {
  const [v, iv, tag, data] = enc.split(".");
  if (v !== "v1") throw new Error("Unknown ciphertext version");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export const encryptOpt = (s: string | null | undefined) => (s ? encrypt(s) : null);
export const decryptOpt = (s: string | null | undefined) => (s ? decrypt(s) : null);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt.${salt.toString("base64")}.${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split(".");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function hmac(alg: "sha256", secret: string, payload: string, encoding: "hex" | "base64"): string {
  return createHmac(alg, secret).update(payload).digest(encoding);
}

// PKCE S256 code challenge
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Constant-time string comparison (compares fixed-length digests, so length does not leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/**
 * A purpose-specific 32-byte key derived (HKDF-SHA256) from ENCRYPTION_KEY, so
 * webhook URL secrets and the like never reuse the data-encryption key itself.
 */
export function deriveKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", key(), Buffer.alloc(0), `movevitals:${purpose}`, 32));
}
