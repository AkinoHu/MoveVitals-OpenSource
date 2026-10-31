import { lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { pkceChallenge, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { loginStates } from "@/lib/db/schema";
import { googleAuthUrl, googleEnabled } from "@/lib/google";
import { newNonce, setNonceCookie } from "@/lib/oauth-binding";
import { appUrl } from "@/lib/providers";

// GET /api/auth/google/start?client=web|app[&link=1]
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleEnabled()) return Response.redirect(new URL("/login?error=google_unavailable", appUrl()), 302);
  const client = url.searchParams.get("client") === "app" ? "app" : "web";
  const linkUserId = url.searchParams.get("link") ? ((await getUser())?.id ?? null) : null;

  const state = randomToken(24);
  const verifier = randomToken(48);
  const { nonce, nonceHash } = newNonce();
  await db.delete(loginStates).where(lt(loginStates.createdAt, new Date(Date.now() - 15 * 60_000)));
  await db.insert(loginStates).values({ state, provider: "google", codeVerifier: verifier, client, linkUserId, nonceHash });
  const res = NextResponse.redirect(googleAuthUrl(state, pkceChallenge(verifier)), 302);
  setNonceCookie(res, "google", nonce);
  return res;
}
