import { NextResponse } from "next/server";
import { consumeVerificationToken } from "@/lib/email-verification";
import { appUrl } from "@/lib/providers";

// GET /api/auth/verify-email?token=… — the link mailed at sign-up.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const ok = token.length >= 20 && !!(await consumeVerificationToken(token));
  return NextResponse.redirect(`${appUrl()}/dashboard/settings?${ok ? "verified=1" : "verify_error=1"}`);
}
