import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { issueAppToken, signInWithIdentity } from "@/lib/accounts";
import { createSession, getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loginStates } from "@/lib/db/schema";
import { exchangeGoogleCode } from "@/lib/google";
import { clearNonceCookie, nonceMatches } from "@/lib/oauth-binding";
import { appUrl } from "@/lib/providers";

// The iOS app listens for this URL scheme (ASWebAuthenticationSession).
const APP_CALLBACK = "movevitals://auth";

export async function GET(req: Request) {
  const res = await handle(req);
  // The cookie is single use, whatever the outcome.
  const out = res instanceof NextResponse ? res : new NextResponse(null, { status: res.status, headers: res.headers });
  clearNonceCookie(out, "google");
  return out;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const [pending] = await db.delete(loginStates).where(eq(loginStates.state, state)).returning();
  const toApp = pending?.client === "app";
  const fail = (code: string) =>
    Response.redirect(toApp ? `${APP_CALLBACK}?error=${code}` : new URL(`/login?error=${code}`, appUrl()).toString(), 302);

  if (!pending || Date.now() - pending.createdAt.getTime() > 15 * 60_000) return fail("expired");
  const code = url.searchParams.get("code");
  // Login-CSRF guard: only the browser that started this flow may finish it.
  if (!nonceMatches(req, "google", pending.nonceHash)) return fail("expired");
  // A link request must still come from the signed-in user it was started for.
  if (pending.linkUserId && (await getUser())?.id !== pending.linkUserId) return fail("expired");
  if (!code) return fail(url.searchParams.get("error") === "access_denied" ? "cancelled" : "google_failed");

  try {
    const identity = await exchangeGoogleCode(code, pending.codeVerifier);
    const result = await signInWithIdentity(identity, pending.linkUserId);
    if ("error" in result) return fail(result.error);
    if (pending.linkUserId) return Response.redirect(new URL("/dashboard/settings?linked=google", appUrl()), 302);
    if (toApp) {
      const token = await issueAppToken(result.userId, "iPhone (Google sign-in)");
      return Response.redirect(`${APP_CALLBACK}?token=${encodeURIComponent(token)}`, 302);
    }
    await createSession(result.userId);
    return Response.redirect(new URL(result.created ? "/dashboard/connections" : "/dashboard", appUrl()), 302);
  } catch (e) {
    console.error("[auth] google sign-in failed", e);
    return fail("google_failed");
  }
}
