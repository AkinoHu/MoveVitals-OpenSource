# Provider setup

All OAuth redirect URIs follow one pattern:

```
https://<your-domain>/api/connections/<provider>/callback
```

Webhooks:

```
https://<your-domain>/api/webhooks/<provider>
```

Providers that do not sign their deliveries (Strava, Oura, Withings, Concept2) are authenticated with a
secret `?k=<key>` appended to the webhook URL. The key is derived from `ENCRYPTION_KEY`; print the exact URLs with
`pnpm webhooks:setup concept2` (needs `APP_URL` and `ENCRYPTION_KEY`). Unkeyed deliveries get HTTP 401 — set
`WEBHOOK_ALLOW_UNKEYED=1` only temporarily while old subscriptions are being re-registered. Strava keeps one
subscription per app: delete the old one (`DELETE https://www.strava.com/api/v3/push_subscriptions/<id>`) before
running `pnpm webhooks:setup strava` again. Deauthorisation events are never trusted on their own: the connection is
re-checked against the provider API first, and only a confirmed revocation clears tokens (and, for Strava, deletes the
source's data as its API terms require).

For local development add the `http://localhost:3000/...` variants where the provider allows them.

| Provider | Where to register | Redirect URI | Webhook | Env vars |
|---|---|---|---|---|
| WHOOP | developer-dashboard.whoop.com | `/api/connections/whoop/callback` | Set `/api/webhooks/whoop` (v2) in the dashboard | `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` |
| Strava | strava.com/settings/api | Callback domain: your domain | `pnpm webhooks:setup strava` | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN` |
| Polar | admin.polaraccesslink.com | `/api/connections/polar/callback` | `pnpm webhooks:setup polar` → save secret as `POLAR_WEBHOOK_SECRET` | `POLAR_CLIENT_ID`, `POLAR_CLIENT_SECRET` |
| Oura | cloud.ouraring.com/oauth/applications | `/api/connections/oura/callback` | `pnpm webhooks:setup oura` | `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_WEBHOOK_VERIFY_TOKEN` |
| Withings | developer.withings.com/dashboard | `/api/connections/withings/callback` | Automatic per user on connect | `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET` |
| Concept2 | log.concept2.com/developers/keys (self-serve) | `/api/connections/concept2/callback` | Webhook URL `/api/webhooks/concept2?k=<key>` | `CONCEPT2_CLIENT_ID`, `CONCEPT2_CLIENT_SECRET` |
| Dexcom | developer.dexcom.com (sandbox self-serve; production review) | `/api/connections/dexcom/callback` | — (polled hourly) | `DEXCOM_CLIENT_ID`, `DEXCOM_CLIENT_SECRET`, `DEXCOM_ENV` |

## WHOOP application form

| Field | Value |
|---|---|
| Name | MoveVitals |
| Logo | `public/logo.png` |
| Contact email | hello@movevitals.com |
| Privacy Policy | https://movevitals.com/privacy |
| Redirect URLs | `https://<your-domain>/api/connections/whoop/callback` and `http://localhost:3000/api/connections/whoop/callback` |
| Scopes | read:recovery, read:cycles, read:workout, read:sleep, read:profile, read:body_measurement (+ `offline` is requested at runtime for refresh tokens) |
| Webhook URL (v2) | https://<your-domain>/api/webhooks/whoop |

## Strava notes

- New apps start in "single player mode" (1 connected athlete). Request a capacity increase via the Strava developer form once ready.
- The Strava API Agreement restricts use of Strava data with AI. MoveVitals excludes Strava-sourced values from AI analysis by default (`aiRestricted` in `src/lib/providers/catalog.ts`).

## Not yet available

- **COROS**: connected directly through the official COROS MCP (OAuth2).
- **Zwift / Zepp / Ultrahuman / TrainingPeaks**: partner-only APIs with no public spec. Until a partnership exists, Zwift data arrives via Strava (origin is preserved, see `stravaOrigin`).
- **Huawei Health Kit**: requires a Huawei developer account with health-data qualification review; not implemented yet.
- **Fitbit**: the legacy Web API was shut down in September 2026; Google Health API is the successor and is not implemented yet.
- **Apple Health, Polar H10 BLE, Magene T600 (FTMS)**: device-only; the iOS app will push to `POST /api/ingest` with a personal API token.
