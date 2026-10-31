import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { issueAppToken, verifyCredentials } from "@/lib/accounts";
import { profile } from "@/lib/mobile";

const Body = z.object({ email: z.string(), password: z.string(), device: z.string().max(80).default("iPhone") });

// POST /api/mobile/login → { token, user }
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const userId = await verifyCredentials(parsed.data.email, parsed.data.password, clientIp(req.headers));
  if (!userId) return Response.json({ error: "invalid_credentials" }, { status: 401 });
  const token = await issueAppToken(userId, parsed.data.device);
  return Response.json({ token, user: await profile(userId) });
}
