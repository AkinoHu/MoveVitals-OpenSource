// Optional CAPTCHA hook (Cloudflare Turnstile). Inactive until BOTH
// TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY are set, so enabling
// it can never lock out forms that lack the widget.

export const captchaEnabled = () => !!process.env.TURNSTILE_SECRET_KEY && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** True when no CAPTCHA is configured or the submitted token verifies. */
export async function verifyCaptcha(form: FormData, ip: string): Promise<boolean> {
  if (!captchaEnabled()) return true;
  const token = String(form.get("cf-turnstile-response") ?? "");
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token, ...(ip !== "unknown" ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false; // fail closed
  }
}
