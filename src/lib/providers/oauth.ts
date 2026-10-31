import { ProviderError, type Credentials, type TokenSet } from "./types";

const TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_S = 20;

// Error text ends up in connections.last_error / sync_runs.error and in the UI,
// so it must never carry secrets: URLs are reduced to host + path (query strings
// often hold tokens), and bodies are scrubbed and clipped.
export function redact(text: string, max = 160): string {
  return text
    .replace(/https?:\/\/[^\s"']+/g, (u) => {
      try {
        const x = new URL(u);
        return `${x.origin}${x.pathname}`;
      } catch {
        return "[url]";
      }
    })
    .replace(/("?(?:access_token|refresh_token|id_token|client_secret|code|password|api[_-]?key|token)"?\s*[:=]\s*)"?[^",&\s}]+"?/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[url]";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fetch with a timeout and one polite retry on HTTP 429 (honouring Retry-After).
async function request(url: string, init: RequestInit): Promise<Response> {
  const go = () => fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  let res: Response;
  try {
    res = await go();
  } catch (e) {
    throw new ProviderError(`${init.method ?? "GET"} ${safeUrl(url)} failed: ${(e as Error).name === "TimeoutError" ? "timed out" : "network error"}`, 504);
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after")) || 5;
    if (wait <= MAX_RETRY_WAIT_S) {
      await res.body?.cancel().catch(() => undefined);
      await sleep(wait * 1000);
      try {
        return await go();
      } catch (e) {
        throw new ProviderError(`${init.method ?? "GET"} ${safeUrl(url)} failed: ${(e as Error).name === "TimeoutError" ? "timed out" : "network error"}`, 504);
      }
    }
  }
  return res;
}

function parseJson<T>(text: string, what: string, status: number): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(`${what} returned a non-JSON response (${status})`, 502);
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
  [k: string]: unknown;
};

// Standard RFC 6749 token request. `auth: "basic"` sends the client
// credentials as HTTP Basic, otherwise they go in the form body.
export async function tokenRequest(
  url: string,
  params: Record<string, string>,
  creds: Credentials,
  auth: "body" | "basic" = "body",
): Promise<TokenResponse> {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (auth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", creds.clientId);
    body.set("client_secret", creds.clientSecret);
  }
  const res = await request(url, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`Token request failed (${res.status}): ${redact(text)}`, res.status);
  return parseJson<TokenResponse>(text, "Token endpoint", res.status);
}

export function toTokenSet(t: TokenResponse): TokenSet {
  const expiresAt = t.expires_at ? new Date(t.expires_at * 1000) : t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null;
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt, scopes: t.scope ?? null };
}

// JSON fetch with a useful error message and rate-limit awareness.
export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await request(url, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    const retry = Number(res.headers.get("retry-after")) || undefined;
    throw new ProviderError(`${init.method ?? "GET"} ${safeUrl(url)} -> ${res.status}: ${redact(text)}`, res.status, retry);
  }
  return text ? parseJson<T>(text, safeUrl(url), res.status) : (undefined as T);
}
