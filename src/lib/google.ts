// "Sign in with Google" (OpenID Connect, authorization code + PKCE).
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; the redirect URI to
// register in Google Cloud is {APP_URL}/api/auth/google/callback.

import { appUrl } from "./providers";
import type { ExternalIdentity } from "./accounts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = () => `${appUrl()}/api/auth/google/callback`;

export function googleAuthUrl(state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${q}`;
}

// The ID token comes straight from Google's token endpoint over TLS using our
// client secret, so its claims can be trusted without re-verifying the
// signature (OIDC Core §3.1.3.7); issuer and audience are still checked.
export async function exchangeGoogleCode(code: string, verifier: string): Promise<ExternalIdentity> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("google: no id_token");
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString("utf8")) as {
    iss: string;
    aud: string;
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    exp: number;
  };
  if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss)) throw new Error("google: bad issuer");
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("google: bad audience");
  if (claims.exp * 1000 < Date.now()) throw new Error("google: expired token");
  return { provider: "google", subject: claims.sub, email: claims.email ?? null, emailVerified: !!claims.email_verified, name: claims.name ?? null };
}
