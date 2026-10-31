import { eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// The signed-in user's avatar. Cached privately; the URL carries ?v=<updated>
// so a new upload is picked up immediately.
export async function GET() {
  const user = await getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const [row] = await db.select({ avatar: users.avatar }).from(users).where(eq(users.id, user.id));
  const m = row?.avatar && /^data:(image\/(?:webp|jpeg|png));base64,(.+)$/.exec(row.avatar);
  if (!m) return new Response("not found", { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
