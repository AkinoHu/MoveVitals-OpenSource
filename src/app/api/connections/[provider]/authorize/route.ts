import { NextResponse } from "next/server";
import { currentSessionId, getUser } from "@/lib/auth";
import { pkceChallenge, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { oauthStates } from "@/lib/db/schema";
import { newNonce, setNonceCookie } from "@/lib/oauth-binding";
import { appUrl, credentialsFor, getAdapter, redirectUri } from "@/lib/providers";

export async function GET(req: Request, ctx: RouteContext<"/api/connections/[provider]/authorize">) {
  const { provider } = await ctx.params;
  const user = await getUser();
  if (!user) return Response.redirect(`${appUrl()}/login`);
  const adapter = getAdapter(provider);
  const creds = adapter && credentialsFor(adapter);
  if (!adapter || !creds) return Response.redirect(`${appUrl()}/dashboard/connections?error=not_configured&provider=${provider}`);

  const state = randomToken(24);
  const { nonce, nonceHash } = newNonce();
  const sessionId = await currentSessionId();
  // Redirect to the provider and set the one-time cookie that the callback must echo back.
  const go = (to: string) => {
    const res = NextResponse.redirect(to);
    setNonceCookie(res, provider, nonce);
    return res;
  };
  const codeVerifier = adapter.authorize.pkce ? randomToken(48) : null;
  const codeChallenge = codeVerifier ? pkceChallenge(codeVerifier) : null;

  if (adapter.authorize.build) {
    try {
      const { url, extra } = await adapter.authorize.build({ state, codeChallenge, redirectUri: redirectUri(provider), query: new URL(req.url).searchParams });
      await db.insert(oauthStates).values({ state, userId: user.id, provider, codeVerifier, extra: extra ?? null, nonceHash, sessionId });
      return go(url);
    } catch (e) {
      console.error(`[oauth:${provider}] authorize`, e);
      return Response.redirect(`${appUrl()}/dashboard/connections?error=exchange_failed&provider=${provider}`);
    }
  }

  await db.insert(oauthStates).values({ state, userId: user.id, provider, codeVerifier, nonceHash, sessionId });
  const url = new URL(adapter.authorize.url);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("state", state);
  if (adapter.authorize.scopes.length) url.searchParams.set("scope", adapter.authorize.scopes.join(adapter.authorize.scopeSeparator ?? " "));
  for (const [k, v] of Object.entries(adapter.authorize.params ?? {})) url.searchParams.set(k, v);
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return go(url.toString());
}
