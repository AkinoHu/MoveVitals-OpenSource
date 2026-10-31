import { z } from "zod";
import { after } from "next/server";
import { createPasswordUser, isEmail, issueAppToken, normaliseEmail, signupAllowed } from "@/lib/accounts";
import { clientIp } from "@/lib/client-ip";
import { sendVerificationEmail } from "@/lib/email-verification";
import { profile } from "@/lib/mobile";

const Body = z.object({
  email: z.string(),
  password: z.string().min(8),
  name: z.string().max(80).optional(),
  device: z.string().max(80).default("iPhone"),
  // The app shows the Privacy Policy and Terms and requires explicit consent.
  agree: z.literal(true),
});

// POST /api/mobile/signup → { token, user }
export async function POST(req: Request) {
  if (process.env.ALLOW_SIGNUP === "false") return Response.json({ error: "signup_closed" }, { status: 403 });
  if (!(await signupAllowed(clientIp(req.headers)))) return Response.json({ error: "rate_limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const { email, password, name, device } = parsed.data;
  if (!isEmail(normaliseEmail(email))) return Response.json({ error: "invalid_email" }, { status: 400 });
  const userId = await createPasswordUser(email, password, name?.trim() || null);
  if (!userId) return Response.json({ error: "email_taken" }, { status: 409 });
  after(() => sendVerificationEmail(userId).catch(() => {}));
  const token = await issueAppToken(userId, device);
  return Response.json({ token, user: await profile(userId) }, { status: 201 });
}
