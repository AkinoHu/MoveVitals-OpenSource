import { concept2 } from "./concept2";
import { coros } from "./coros";
import { dexcom } from "./dexcom";
import { oura } from "./oura";
import { polar } from "./polar";
import { strava } from "./strava";
import type { Credentials, ProviderAdapter } from "./types";
import { whoop } from "./whoop";
import { withings } from "./withings";

export const ADAPTERS: Record<string, ProviderAdapter> = { whoop, strava, polar, oura, withings, concept2, dexcom, coros };

export function getAdapter(id: string): ProviderAdapter | null {
  return ADAPTERS[id] ?? null;
}

export function credentialsFor(adapter: ProviderAdapter): Credentials | null {
  // Registered on first connect; the adapter resolves the real client itself.
  if (adapter.dynamicClient) return { clientId: "dynamic", clientSecret: "" };
  const clientId = process.env[`${adapter.envPrefix}_CLIENT_ID`];
  const clientSecret = process.env[`${adapter.envPrefix}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(providerId: string): string {
  return `${appUrl()}/api/connections/${providerId}/callback`;
}
