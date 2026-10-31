import { getUser } from "@/lib/auth";
import { reportFile } from "@/lib/lab/data";

// Serves an uploaded report to its owner, decrypted, never cached.
export async function GET(_: Request, { params }: RouteContext<"/api/lab/reports/[id]">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const file = /^[0-9a-f-]{36}$/.test(id) ? await reportFile(user.id, id) : null;
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
