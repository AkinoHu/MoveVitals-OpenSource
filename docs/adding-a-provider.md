# Adding a provider

A provider adapter connects one platform's official API to MoveVitals. Existing adapters in `src/lib/providers/` are the best reference — `whoop.ts` (pull + signed webhooks) and `garmin.ts` (push) cover both styles.

## 1. Catalogue entry

Add or update the platform in `src/lib/providers/catalog.ts` (`status: "live"`), and add its `data` / `path` copy to `catalog` in every dictionary under `src/i18n/dict/`.

## 2. Adapter

Create `src/lib/providers/<id>.ts` exporting a `ProviderAdapter` (`src/lib/providers/types.ts`):

| Member | Purpose |
|---|---|
| `envPrefix` | Credentials come from `<PREFIX>_CLIENT_ID` / `<PREFIX>_CLIENT_SECRET` |
| `authorize` | OAuth URL, scopes, `pkce` if required |
| `exchangeCode` / `refresh` | Token handling; return `externalUserId` so webhooks can find the connection |
| `sync(ctx)` | Fetch everything since `ctx.since` and write it with `ctx.ingest` |
| `webhook.parse` | Verify the delivery (signature or token) and return the upstream user id |
| `webhook.ingest` | Only for push-style APIs that deliver data in the webhook body |

Map upstream fields onto canonical metrics (`src/lib/metrics.ts`) and sports (`src/lib/sports.ts`). Use stable `externalId`s so re-syncs are idempotent, and store the raw payload with `ingest.raw()`.

Register the adapter in `src/lib/providers/index.ts`, add its variables to `.env.example`, and document the redirect/webhook URLs in `docs/providers.md`.

## 3. Test

Add mapping tests with recorded (anonymised) sample payloads, then connect a real account locally with `http://localhost:3000/api/connections/<id>/callback` registered as a redirect URI.
