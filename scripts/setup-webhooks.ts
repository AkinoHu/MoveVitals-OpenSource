// One-off registration of app-level webhook subscriptions. Run after deploy
// (needs ENCRYPTION_KEY, because unsigned providers get a secret `?k=` URL key):
//   APP_URL=https://movevitals.com pnpm webhooks:setup [strava|polar|oura|concept2]
// WHOOP webhooks are configured in the WHOOP developer dashboard; Withings
// subscriptions are per user and created automatically on connect.

import { webhookUrl } from "../src/lib/webhook-key";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) throw new Error("APP_URL must be the public https URL");
const hook = (p: string) => webhookUrl(p, APP_URL);

async function strava() {
  // Strava allows one subscription per app: drop the existing one (e.g. an older
  // URL without the key) before registering the current URL.
  const auth = new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID!, client_secret: process.env.STRAVA_CLIENT_SECRET! });
  const existing = (await (await fetch(`https://www.strava.com/api/v3/push_subscriptions?${auth}`)).json()) as { id: number; callback_url: string }[];
  for (const sub of Array.isArray(existing) ? existing : []) {
    if (sub.callback_url === hook("strava")) return console.log("strava: already registered");
    const del = await fetch(`https://www.strava.com/api/v3/push_subscriptions/${sub.id}?${auth}`, { method: "DELETE" });
    console.log("strava: removed old subscription", sub.id, del.status);
  }
  const body = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    client_secret: process.env.STRAVA_CLIENT_SECRET!,
    callback_url: hook("strava"),
    verify_token: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN!,
  });
  const res = await fetch("https://www.strava.com/api/v3/push_subscriptions", { method: "POST", body });
  console.log("strava", res.status, res.ok ? "registered" : (await res.text()).slice(0, 200));
}

async function polar() {
  const auth = Buffer.from(`${process.env.POLAR_CLIENT_ID}:${process.env.POLAR_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://www.polaraccesslink.com/v3/webhooks", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ events: ["EXERCISE", "SLEEP"], url: hook("polar") }),
  });
  console.log("polar", res.status, await res.text());
  console.log("→ save data.signature_secret_key as POLAR_WEBHOOK_SECRET");
}

async function oura() {
  const headers = { "x-client-id": process.env.OURA_CLIENT_ID!, "x-client-secret": process.env.OURA_CLIENT_SECRET!, "Content-Type": "application/json" };
  const base = "https://api.ouraring.com/v2/webhook/subscription";
  // Remove subscriptions pointing anywhere else (e.g. the older unkeyed URL).
  const existing = (await (await fetch(base, { headers })).json()) as { id: string; callback_url: string; event_type: string; data_type: string }[];
  const current = new Set<string>();
  for (const sub of Array.isArray(existing) ? existing : []) {
    if (sub.callback_url === hook("oura")) current.add(`${sub.data_type}:${sub.event_type}`);
    else console.log("oura: removed old", sub.data_type, sub.event_type, (await fetch(`${base}/${sub.id}`, { method: "DELETE", headers })).status);
  }
  for (const data_type of ["sleep", "daily_readiness", "daily_activity", "workout", "daily_spo2"]) {
    for (const event_type of ["create", "update"]) {
      if (current.has(`${data_type}:${event_type}`)) continue;
      const res = await fetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({ callback_url: hook("oura"), verification_token: process.env.OURA_WEBHOOK_VERIFY_TOKEN, event_type, data_type }),
      });
      console.log("oura", data_type, event_type, res.status, res.ok ? "registered" : (await res.text()).slice(0, 200));
    }
  }
}

const which = process.argv.slice(2);
// Garmin and Concept2 URLs are entered in their developer portals by hand.
async function concept2() {
  console.log("concept2: set the webhook URL to", hook("concept2"));
}

const all = { strava, polar, oura, concept2 };
(async () => {
  for (const [name, fn] of Object.entries(all)) if (which.length === 0 || which.includes(name)) await fn().catch((e) => console.error(name, e));
})();
