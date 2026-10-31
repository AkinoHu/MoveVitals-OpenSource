import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, activityGroups } from "@/lib/db/schema";
import { mobileUserId, unauthorized } from "@/lib/mobile";

// GET /api/mobile/activities?limit=30&before=ISO → de-duplicated activities
// (one per activity group, using its primary recording).
export async function GET(req: Request) {
  const userId = await mobileUserId(req);
  if (!userId) return unauthorized();
  const q = new URL(req.url).searchParams;
  const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 30));
  const before = q.get("before") ? new Date(q.get("before")!) : null;
  const rows = await db
    .select({
      id: activities.id,
      name: activities.name,
      sport: activities.sport,
      provider: activities.provider,
      origin: activities.origin,
      startTime: activities.startTime,
      endTime: activities.endTime,
      distanceM: activities.distanceM,
      avgHr: activities.avgHr,
      avgPower: activities.avgPower,
      calories: activities.calories,
      sources: activityGroups.memberCount,
    })
    .from(activityGroups)
    .innerJoin(activities, eq(activities.id, activityGroups.primaryActivityId))
    .where(and(eq(activityGroups.userId, userId), before ? lt(activityGroups.startTime, before) : undefined))
    .orderBy(desc(activityGroups.startTime))
    .limit(limit);
  return Response.json({ activities: rows });
}
