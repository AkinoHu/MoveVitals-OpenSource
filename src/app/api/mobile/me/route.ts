import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { mobileUserId, profile, unauthorized } from "@/lib/mobile";

// GET /api/mobile/me → profile, settings, connections
export async function GET(req: Request) {
  const userId = await mobileUserId(req);
  if (!userId) return unauthorized();
  return Response.json({ user: await profile(userId) });
}

const Patch = z.object({ cloudSync: z.boolean().optional(), name: z.string().max(80).optional(), units: z.enum(["metric", "imperial"]).optional() });

// PATCH /api/mobile/me { cloudSync?, name?, units? }
export async function PATCH(req: Request) {
  const userId = await mobileUserId(req);
  if (!userId) return unauthorized();
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  if (Object.keys(parsed.data).length) await db.update(users).set(parsed.data).where(eq(users.id, userId));
  return Response.json({ user: await profile(userId) });
}
