// Binds an OAuth round trip to the browser that started it.
//
// `state` alone proves nothing about who completes the flow: an attacker can
// start a flow, then lure a victim's browser to the provider (or straight to
// our callback) with the attacker's state, so the victim's account ends up
// linked to - or signed in as - the attacker's. So the start of the flow also
// sets a random one-time httpOnly cookie, we store only its hash next to the
// state, and the callback must present the same cookie.

import type { NextResponse } from "next/server";
import { randomToken, safeEqual, sha256 } from "./crypto";

export const nonceCookieName = (scope: string) => `mv_oauth_${scope.replace(/[^a-z0-9_]/gi, "_")}`;

export function newNonce(): { nonce: string; nonceHash: string } {
  const nonce = randomToken(24);
  return { nonce, nonceHash: sha256(nonce) };
}

export function setNonceCookie(res: NextResponse, scope: string, nonce: string): void {
  res.cookies.set(nonceCookieName(scope), nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // the provider redirects back with a top-level GET
    path: "/api/",
    maxAge: 15 * 60,
  });
}

export function clearNonceCookie(res: NextResponse, scope: string): void {
  res.cookies.set(nonceCookieName(scope), "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/", maxAge: 0 });
}

/** True when the request carries the cookie whose hash was stored with the state. */
export function nonceMatches(req: Request, scope: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const name = nonceCookieName(scope);
  const raw = req.headers.get("cookie") ?? "";
  const value = raw
    .split(/;\s*/)
    .map((c) => c.split("="))
    .find(([k]) => k === name)?.[1];
  return !!value && safeEqual(sha256(decodeURIComponent(value)), storedHash);
}
