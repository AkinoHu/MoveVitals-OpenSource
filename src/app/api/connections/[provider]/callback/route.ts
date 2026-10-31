import { and, eq, gt } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { currentSessionId, getUser } from "@/lib/auth";
import { encrypt, encryptOpt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { connections, oauthStates } from "@/lib/db/schema";
import { clearNonceCookie, nonceMatches } from "@/lib/oauth-binding";
import { appUrl, credentialsFor, getAdapter, redirectUri } from "@/lib/providers";
import { runSync } from "@/lib/sync";

const back = (provider: string, params: Record<string, string>) => {
  const res = NextResponse.redirect(`${appUrl()}/dashboard/connections?${new URLSearchParams(params)}`);
  clearNonceCookie(res, provider); // single use, whatever the outcome
  return res;
};

export async function GET(req: Request, ctx: RouteContext<"/api/connections/[provider]/callback">) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const upstreamError = url.searchParams.get("error");
  if (upstreamError) return back(provider, { error: "denied", provider });
  if (!code || !state) return back(provider, { error: "invalid_callback", provider });

  const [st] = await db
    .delete(oauthStates)
    .where(and(eq(oauthStates.state, state), eq(oauthStates.provider, provider), gt(oauthStates.createdAt, new Date(Date.now() - 15 * 60_000))))
    .returning();
  if (!st) return back(provider, { error: "state_expired", provider });

  // Login-CSRF guard: the callback must come from the browser and the signed-in
  // session that started the flow, not just carry a valid state.
  const [user, sessionId] = await Promise.all([getUser(), currentSessionId()]);
  const sameBrowser = nonceMatches(req, provider, st.nonceHash);
  const sameSession = !!user && user.id === st.userId && (!st.sessionId || st.sessionId === sessionId);
  if (!sameBrowser || !sameSession) {
    console.warn(`[oauth:${provider}] callback rejected: browser=${sameBrowser} session=${sameSession}`);
    return back(provider, { error: "state_mismatch", provider });
  }

  const adapter = getAdapter(provider);
  const creds = adapter && credentialsFor(adapter);
  if (!adapter || !creds) return back(provider, { error: "not_configured", provider });

  try {
    let token = await adapter.exchangeCode(code, redirectUri(provider), creds, st.codeVerifier, st.extra);
    if (adapter.afterConnect) token = { ...token, ...(await adapter.afterConnect(token, creds, { userId: st.userId })) };

    const values = {
      userId: st.userId,
      provider,
      externalUserId: token.externalUserId ?? null,
      displayName: token.displayName ?? null,
      accessTokenEnc: encrypt(token.accessToken),
      refreshTokenEnc: encryptOpt(token.refreshToken),
      tokenExpiresAt: token.expiresAt ?? null,
      scopes: token.scopes ?? null,
      status: "active",
      lastError: null,
      ...(token.cursor ? { cursor: token.cursor } : {}),
      updatedAt: new Date(),
    };
    const [conn] = await db
      .insert(connections)
      .values(values)
      .onConflictDoUpdate({ target: [connections.userId, connections.provider], set: values })
      .returning({ id: connections.id });

    // Backfill history without making the user wait.
    after(() => runSync(conn.id, "initial"));
    return back(provider, { connected: provider });
  } catch (e) {
    console.error(`[oauth:${provider}]`, e);
    return back(provider, { error: "exchange_failed", provider });
  }
}
