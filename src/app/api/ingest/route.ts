import { eq, ne } from "drizzle-orm";
import { z } from "zod";
import { isAttributeKey, normaliseAttribute } from "@/lib/attributes";
import { db } from "@/lib/db";
import { userAttributes, users } from "@/lib/db/schema";
import { userFromApiToken } from "@/lib/auth";
import { Ingestor } from "@/lib/ingest";
import { METRIC_MAP } from "@/lib/metrics";
import { isSport, type Sport } from "@/lib/sports";

// Push endpoint for the MoveVitals iOS app (HealthKit, Polar BLE, FTMS) and
// for scripts. Authenticate with a personal API token: `Authorization: Bearer mv_…`.

const device = z.object({ brand: z.string().optional(), model: z.string(), kind: z.string().optional() }).optional();

const Body = z.object({
  provider: z.enum(["apple_health", "polar_ble", "magene", "health_connect", "manual"]),
  observations: z
    .array(
      z.object({
        metric: z.string().refine((m) => m in METRIC_MAP, "unknown metric"),
        value: z.number(),
        granularity: z.enum(["daily", "session", "sample"]).default("daily"),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        startTime: z.coerce.date().optional(),
        endTime: z.coerce.date().optional(),
        externalId: z.string().min(1),
        origin: z.string().optional(),
        device,
      }),
    )
    .max(5000)
    .default([]),
  activities: z
    .array(
      z.object({
        externalId: z.string().min(1),
        name: z.string().optional(),
        sport: z.string().refine(isSport).optional(),
        sportRaw: z.string().optional(),
        startTime: z.coerce.date(),
        endTime: z.coerce.date(),
        distanceM: z.number().optional(),
        elevationGainM: z.number().optional(),
        avgHr: z.number().optional(),
        maxHr: z.number().optional(),
        avgPower: z.number().optional(),
        avgCadence: z.number().optional(),
        calories: z.number().optional(),
        origin: z.string().optional(),
        device,
        streams: z.record(z.string(), z.array(z.number())).optional(),
      }),
    )
    .max(500)
    .default([]),
  // Body profile (height, date of birth…), e.g. from HealthKit characteristics.
  attributes: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .max(20)
    .default([]),
});

export async function POST(req: Request) {
  const userId = await userFromApiToken(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  // With cloud sync off, on-device data must stay on the device.
  const [owner] = await db.select({ cloudSync: users.cloudSync }).from(users).where(eq(users.id, userId));
  if (!owner?.cloudSync) return Response.json({ error: "cloud_sync_disabled" }, { status: 409 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body", issues: parsed.error.issues.slice(0, 20) }, { status: 400 });
  const { provider, observations, activities, attributes } = parsed.data;

  const ingest = new Ingestor(userId, provider);
  for (const o of observations) await ingest.observation(o);
  for (const { streams, sport, ...a } of activities) {
    const id = await ingest.activity({ ...a, sport: sport as Sport | undefined });
    if (streams) await ingest.streams(id, streams);
  }
  await ingest.finalize();

  // Device values never overwrite what the user entered by hand.
  for (const a of attributes) {
    if (!isAttributeKey(a.key)) continue;
    const value = normaliseAttribute(a.key, a.value);
    if (value === null) continue;
    await db
      .insert(userAttributes)
      .values({ userId, key: a.key, value, source: provider })
      .onConflictDoUpdate({
        target: [userAttributes.userId, userAttributes.key],
        set: { value, source: provider, updatedAt: new Date() },
        setWhere: ne(userAttributes.source, "manual"),
      });
  }
  return Response.json({ ok: true, stats: ingest.stats });
}
