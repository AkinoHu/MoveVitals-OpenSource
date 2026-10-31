import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

// Outbound requests to user-supplied URLs (the bring-your-own-AI base URL).
// Hosted deployments must never let a user point the server at internal
// services, so: https only, no credentials in the URL, every resolved address
// is checked at connect time (this defeats DNS rebinding), no redirects, a
// timeout and a response size cap. Self-hosters running e.g. Ollama on their
// LAN can opt in with AI_ALLOW_PRIVATE_URLS=1.

export const allowPrivateUrls = () => process.env.AI_ALLOW_PRIVATE_URLS === "1";

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
    });
  }
  if (v === 6) {
    const a = ip.toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const mappedHex = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (a === "::" || a === "::1") return true;
    if (/^f[cd]/.test(a)) return true; // unique local fc00::/7
    if (/^fe[89ab]/.test(a)) return true; // link-local fe80::/10
    if (/^ff/.test(a)) return true; // multicast
    if (a.startsWith("64:ff9b:") || a.startsWith("2001:db8:") || a.startsWith("2002:")) return true; // NAT64, docs, 6to4
    return false;
  }
  return true; // not an IP at all: refuse
}

// Static checks on the URL itself (used at save time and before each request).
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid URL");
  }
  const priv = allowPrivateUrls();
  if (u.protocol !== "https:" && !(priv && u.protocol === "http:")) throw new UnsafeUrlError("only https URLs are allowed");
  if (u.username || u.password) throw new UnsafeUrlError("credentials in URLs are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!priv) {
    if (isIP(host) && isPrivateIp(host)) throw new UnsafeUrlError("address is not allowed");
    if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new UnsafeUrlError("host is not allowed");
  }
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

// dns.lookup replacement used by the socket itself: whatever it resolves to is
// what we connect to, so there is no check/use gap.
function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, cb: LookupCb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, "");
    const list = addrs as LookupAddress[];
    if (!allowPrivateUrls() && list.some((a) => isPrivateIp(a.address))) return cb(new UnsafeUrlError("address is not allowed") as NodeJS.ErrnoException, "");
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

export type SafeResponse = { status: number; text: string; json: unknown };

export async function safeJsonPost(
  rawUrl: string,
  headers: Record<string, string>,
  body: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<SafeResponse> {
  const url = checkUrl(rawUrl);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
  const mod = url.protocol === "https:" ? https : http;

  return new Promise<SafeResponse>((resolve, reject) => {
    const req = mod.request(
      url,
      { method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body).toString() }, lookup: guardedLookup as never, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new Error("response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) return reject(new Error("redirects are not followed"));
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            // handled by the caller: non-JSON bodies are an error, not a crash
          }
          resolve({ status, text, json });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", (e) => reject(e instanceof UnsafeUrlError ? e : new Error(e.message === "request timed out" || e.message === "response too large" ? e.message : "could not reach the model endpoint")));
    req.end(body);
  });
}
