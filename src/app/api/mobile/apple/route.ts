import { z } from "zod";
import { issueAppToken, signInWithIdentity } from "@/lib/accounts";
import { verifyAppleIdentityToken } from "@/lib/apple";
import { profile } from "@/lib/mobile";

const Body = z.object({
  identityToken: z.string().min(20),
  // Apple sends the name only on the first authorization.
  name: z.string().max(80).optional(),
  device: z.string().max(80).default("iPhone"),
});

// POST /api/mobile/apple → { token, user }
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  try {
    const identity = await verifyAppleIdentityToken(parsed.data.identityToken, parsed.data.name?.trim() || null);
    const result = await signInWithIdentity(identity);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.error === "signup_closed" ? 403 : 400 });
    const token = await issueAppToken(result.userId, `${parsed.data.device} (Apple sign-in)`);
    return Response.json({ token, user: await profile(result.userId) }, { status: result.created ? 201 : 200 });
  } catch (e) {
    console.error("[auth] apple sign-in failed", e);
    return Response.json({ error: "apple_failed" }, { status: 401 });
  }
}
