import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyMetrics } from "@/lib/db/schema";
import { mobileUserId, unauthorized } from "@/lib/mobile";

// GET /api/mobile/summary?days=14 → resolved daily metrics (one value per
// metric per day, already conflict-resolved by the user's priorities).
export async function GET(req: Request) {
  const userId = await mobileUserId(req);
  if (!userId) return unauthorized();
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 14));
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ day: dailyMetrics.day, metric: dailyMetrics.metric, value: dailyMetrics.value, unit: dailyMetrics.unit, source: dailyMetrics.selectedProvider, conflict: dailyMetrics.hasConflict })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.userId, userId), gte(dailyMetrics.day, since)))
    .orderBy(asc(dailyMetrics.day));
  return Response.json({ days, metrics: rows });
}
