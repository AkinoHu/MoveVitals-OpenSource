// Minimal transactional mailer over the Resend HTTP API (no SDK, no extra
// dependency). Configure with RESEND_API_KEY and MAIL_FROM
// ("MoveVitals <noreply@your-domain>"). Without them mail is disabled and the
// features that need it (email verification) stay hidden.

export const mailEnabled = () => !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailEnabled()) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[mail] send failed: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("[mail] send failed:", (e as Error).name);
    return false;
  }
}
