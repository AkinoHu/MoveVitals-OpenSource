import { deriveKey, safeEqual } from "./crypto";

// Providers that do not sign their deliveries (Strava, Oura, Withings, Garmin,
// Concept2) are authenticated with a secret path-query key that only we and the
// provider know: HKDF(ENCRYPTION_KEY, "webhook:<provider>"). It is appended to
// the callback URL when the subscription is registered (see
// scripts/setup-webhooks.ts). Providers that sign deliveries keep their HMAC.
export function webhookKey(provider: string): string {
  return deriveKey(`webhook:${provider}`).subarray(0, 24).toString("base64url");
}

export function webhookUrl(provider: string, appUrl = process.env.APP_URL ?? ""): string {
  return `${appUrl.replace(/\/$/, "")}/api/webhooks/${provider}?k=${webhookKey(provider)}`;
}

export function webhookKeyValid(provider: string, req: Request): boolean {
  const k = new URL(req.url).searchParams.get("k");
  return !!k && safeEqual(k, webhookKey(provider));
}

// Transitional escape hatch so subscriptions registered before this change keep
// working until they are re-registered with the keyed URL.
export const allowUnkeyedWebhooks = () => process.env.WEBHOOK_ALLOW_UNKEYED === "1";
