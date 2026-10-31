import type { Ingestor } from "../ingest";
import type { connections } from "../db/schema";

export type Connection = typeof connections.$inferSelect;

export type Credentials = { clientId: string; clientSecret: string };

export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string | null;
  externalUserId?: string | null;
  displayName?: string | null;
  // Initial sync cursor for the connection (e.g. the account region).
  cursor?: Record<string, string>;
};

export type AuthorizeBuild = { state: string; codeChallenge: string | null; redirectUri: string; query: URLSearchParams };

export type SyncContext = {
  connection: Connection;
  userId: string;
  creds: Credentials;
  ingest: Ingestor;
  // Earliest instant to (re)fetch. Adapters may fetch a little more.
  since: Date;
  // Authenticated JSON request with automatic token refresh on 401.
  api: <T = unknown>(url: string, init?: RequestInit) => Promise<T>;
  accessToken: () => Promise<string>;
  forceRefresh: () => Promise<void>;
  timezone: string;
  log: (msg: string) => void;
};

export type WebhookResult = {
  // Upstream user id the event belongs to, used to find the connection.
  externalUserId: string | null;
  // Optional narrow window to re-sync instead of the default.
  // 0 means the user revoked access upstream.
  sinceHours?: number;
  // Push-style providers (Garmin) deliver the data itself; it is handed to
  // `webhook.ingest` instead of triggering a re-sync.
  data?: unknown;
};

export type PushContext = { ingest: Ingestor; timezone: string; log: (msg: string) => void };

export type ProviderAdapter = {
  id: string;
  envPrefix: string; // credentials come from `${envPrefix}_CLIENT_ID` / `_CLIENT_SECRET`
  authorize: {
    url: string;
    scopes: string[];
    scopeSeparator?: string;
    params?: Record<string, string>;
    pkce?: boolean;
    // Builds the authorize URL itself (per-region servers, dynamically
    // registered clients). `extra` is stored with the state for the callback.
    build?: (ctx: AuthorizeBuild) => Promise<{ url: string; extra?: Record<string, string> }>;
  };
  // Client credentials are registered at runtime, not read from env.
  dynamicClient?: boolean;
  exchangeCode: (code: string, redirectUri: string, creds: Credentials, codeVerifier?: string | null, extra?: Record<string, string> | null) => Promise<TokenSet>;
  refresh?: (refreshToken: string, creds: Credentials, connection?: Connection) => Promise<TokenSet>;
  // Called once after the token exchange (e.g. Polar user registration).
  afterConnect?: (token: TokenSet, creds: Credentials, ctx: { userId: string }) => Promise<Partial<TokenSet>>;
  sync: (ctx: SyncContext) => Promise<void>;
  // Best-effort upstream revoke when the user disconnects.
  revoke?: (token: string, creds: Credentials, connection: Connection) => Promise<void>;
  webhook?: {
    // Deliveries are unsigned: require our secret `?k=` URL key (src/lib/webhook-key.ts).
    urlKey?: boolean;
    // Respond to subscription handshakes (GET). Return null if not a handshake.
    handshake?: (req: Request) => Response | null;
    // Verify a delivery and extract the user(s) it belongs to.
    parse: (req: Request, body: string, creds: Credentials) => Promise<WebhookResult | WebhookResult[] | null> | WebhookResult | WebhookResult[] | null;
    // Write pushed data (WebhookResult.data) for one user.
    ingest?: (data: unknown, ctx: PushContext) => Promise<void>;
  };
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
