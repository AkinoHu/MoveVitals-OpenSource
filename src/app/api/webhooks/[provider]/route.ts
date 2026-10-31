import { after } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import { credentialsFor, getAdapter } from "@/lib/providers";
import { processWebhooks } from "@/lib/sync";
import { allowUnkeyedWebhooks, webhookKeyValid } from "@/lib/webhook-key";

const MAX_BODY = 1_000_000;

// Webhooks are acknowledged immediately and queued; the actual re-sync runs
// after the response (and is retried by the worker if the process dies).

// Some providers (Strava) append their verification query with "?" even when
// the callback URL already has one, so "k" arrives as "<key>?hub.mode=…"
// (possibly percent-encoded). Split it back into separate parameters.
function normalised(req: Request): Request {
  const url = new URL(req.url);
  const k = url.searchParams.get("k");
  const at = k?.indexOf("?") ?? -1;
  if (!k || at < 0) return req;
  url.searchParams.set("k", k.slice(0, at));
  for (const [name, value] of new URLSearchParams(k.slice(at + 1))) url.searchParams.set(name, value);
  return new Request(url, req);
}

async function handshake(req: Request, ctx: RouteContext<"/api/webhooks/[provider]">) {
  const { provider } = await ctx.params;
  const adapter = getAdapter(provider);
  const res = adapter?.webhook?.handshake?.(normalised(req)) ?? new Response("not found", { status: 404 });
  // Parameter names only (never values) to diagnose provider handshakes.
  if (res.status !== 200) console.warn(`[webhook:${provider}] handshake ${res.status}; params: ${[...new URL(req.url).searchParams.keys()].join(",")}`);
  return res;
}

export const GET = handshake;
export const HEAD = handshake;

export async function POST(req: Request, ctx: RouteContext<"/api/webhooks/[provider]">) {
  const { provider } = await ctx.params;
  const adapter = getAdapter(provider);
  const creds = adapter && credentialsFor(adapter);
  if (!adapter?.webhook || !creds) return new Response("not found", { status: 404 });

  if (adapter.webhook.urlKey && !webhookKeyValid(provider, req) && !allowUnkeyedWebhooks()) return new Response("unauthorized", { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return new Response("too large", { status: 413 });

  const body = await req.text();
  if (body.length > MAX_BODY) return new Response("too large", { status: 413 });
  let parsed;
  try {
    parsed = await adapter.webhook.parse(req, body, creds);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!parsed) return new Response("invalid signature", { status: 401 });

  const events = (Array.isArray(parsed) ? parsed : [parsed]).filter((e) => e.externalUserId);
  if (events.length) {
    await db.insert(webhookEvents).values(
      events.map((e) => ({
        provider,
        externalUserId: e.externalUserId,
        payload: e.data !== undefined ? { data: e.data } : { sinceHours: e.sinceHours, body: body.slice(0, 4000) },
      })),
    );
    after(() => processWebhooks());
  }
  return new Response("ok");
}
