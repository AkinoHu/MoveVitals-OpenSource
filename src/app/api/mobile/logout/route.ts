import { eq } from "drizzle-orm";
import { sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";

// POST /api/mobile/logout — revokes the calling device's token.
export async function POST(req: Request) {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) await db.delete(apiTokens).where(eq(apiTokens.tokenHash, sha256(token)));
  return new Response(null, { status: 204 });
}
