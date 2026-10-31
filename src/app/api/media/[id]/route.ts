import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";

// CMS images. Ids are random UUIDs and rows are never mutated, so they cache forever.
export async function GET(_: Request, ctx: RouteContext<"/api/media/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [row] = await db.select({ mime: media.mime, data: media.data }).from(media).where(eq(media.id, id));
  if (!row) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": row.mime,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  // SVGs can carry scripts: serve them sandboxed.
  if (row.mime === "image/svg+xml") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new Response(Buffer.from(row.data, "base64"), { headers });
}
