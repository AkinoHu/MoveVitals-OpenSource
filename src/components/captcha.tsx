import Script from "next/script";

// Renders the Turnstile widget inside a form when a CAPTCHA is configured.
// Turnstile injects the hidden `cf-turnstile-response` input itself.
export function Captcha() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div className="cf-turnstile" data-sitekey={siteKey} />
    </>
  );
}
