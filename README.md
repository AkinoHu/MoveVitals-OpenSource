# MoveVitals Open Source

The self-hostable health-data dashboard behind [movevitals.com](https://movevitals.com): connect wearables and training platforms through their official APIs, keep every value with its source, resolve conflicts between devices, track lab results, and analyse it all with your own LLM key.

[Hosted version](https://movevitals.com) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Trademarks](TRADEMARKS.md)

> This repository contains the dashboard and integration platform. The movevitals.com marketing site, guides and content tools are not part of it.

## What it does

- **Provenance first.** Every value keeps the channel it arrived through, the original recorder (e.g. *Zwift via Strava*), the device, and the raw payload it was parsed from.
- **Conflicts are visible.** Values from different sources are stored side by side; a resolution layer picks one per day and metric (or per workout field) using your source priorities, flags disagreements, and lets you override.
- **Field-level workout merging.** The same workout recorded by several platforms becomes one activity: power from the trainer, heart rate from the strap, distance from the watch.
- **Body Lab.** Personal baselines and alerts for HRV, resting heart rate and more; manual lab entry and lab-report upload with AI extraction you confirm before saving.
- **Your model, your key.** AI analysis uses your own Anthropic or OpenAI-compatible key over the sources you allow. Data from platforms whose terms forbid AI use (Strava) is excluded by default.
- **Official APIs only.** No scraping, no reverse-engineered protocols.
- Five languages: English, 简体中文, 繁體中文, Français, Español.

## Integrations in this repository

WHOOP, Strava (and Zwift, Rouvy, MyWhoosh through it), Polar, Oura, Withings, COROS (official MCP), Concept2 Logbook and Dexcom. Apple Health and Bluetooth sensors come through the iOS app in `ios/`.

Each platform needs its own developer app: register one per platform you want and put its credentials in your environment (see [docs/providers.md](docs/providers.md)). Integrations whose developer programmes keep their API documentation confidential are available only on the hosted version.

## Run it locally

```bash
pnpm install
cp .env.example .env.local   # then set ENCRYPTION_KEY: openssl rand -base64 32
pnpm seed:demo               # optional: demo@movevitals.local / demo-password with sample data
pnpm dev
```

Without `DATABASE_URL` an embedded PGlite database is created in `.data/`, so no database setup is needed for development.

## Self-host

- **App:** `pnpm build && pnpm start` (Next.js 16, Node 22). Migrations run on start.
- **Worker:** `pnpm worker` runs scheduled syncs, webhook retries and backups.
- **Database:** Postgres via `DATABASE_URL`.
- **Required:** `APP_URL`, `ENCRYPTION_KEY`, `DATABASE_URL`. Everything else (OAuth apps, email, Google sign-in, AI, S3-compatible backups) is optional and documented in [.env.example](.env.example).
- To show your own privacy policy and terms at sign-up, set `NEXT_PUBLIC_PRIVACY_URL` and `NEXT_PUBLIC_TERMS_URL`.
- **Admin console** (`/admin`: users, backups, integration requests): list admin emails in `ADMIN_EMAILS`; the address must be verified, so configure email (`RESEND_API_KEY`) first.
- If you run a public instance, rename it and replace the logos in `public/` (see [TRADEMARKS.md](TRADEMARKS.md)).

```
Next.js (UI + API routes + webhooks)          worker/ (scheduled sync, webhook retries, backups)
        │                                             │
        └──── src/lib ────────────────────────────────┘
               providers/   OAuth adapters + catalog
               ingest.ts    idempotent writes: raw_records → observations / activities
               resolve.ts   conflict resolution: daily_metrics, activity_groups
               sync.ts      token refresh, sync runs, webhook queue
               ai.ts        bring-your-own-key analysis over resolved, source-tagged data
                     │
               Postgres (PGlite locally)
```

## License

[AGPL-3.0](LICENSE). If you run a modified version as a network service, you must offer its source to your users.

"MoveVitals" and the MoveVitals logo are trademarks and are not covered by the code licence; see [TRADEMARKS.md](TRADEMARKS.md).
