// Local development only: creates a demo account with synthetic multi-source
// data (including deliberate conflicts) so the UI can be exercised without
// real provider credentials.
//   pnpm seed:demo   → login demo@movevitals.local / demo-password
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/lib/crypto";
import { db, migrate } from "../src/lib/db";
import { connections, users } from "../src/lib/db/schema";
import { Ingestor } from "../src/lib/ingest";
import { addDays, dayInTz } from "../src/lib/time";

const EMAIL = "demo@movevitals.local";
const TZ = "Asia/Shanghai";

function rand(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to seed in production");
  await migrate();
  await db.delete(users).where(eq(users.email, EMAIL));
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, name: "Demo", timezone: TZ, passwordHash: await hashPassword("demo-password") })
    .returning();
  for (const provider of ["whoop", "strava", "oura", "polar"]) {
    await db.insert(connections).values({ userId: user.id, provider, displayName: "Demo", status: "active", lastSyncAt: new Date() });
  }

  const today = dayInTz(new Date(), TZ);
  const whoop = new Ingestor(user.id, "whoop");
  const oura = new Ingestor(user.id, "oura");
  const polar = new Ingestor(user.id, "polar");
  const strava = new Ingestor(user.id, "strava");

  for (let i = 0; i < 45; i++) {
    const day = addDays(today, -i);
    const r = rand(i + 1);
    const hrv = 55 + Math.sin(i / 5) * 10 + r * 6;
    const rhr = 50 + Math.cos(i / 6) * 3 + r * 2;
    const sleep = 6.5 * 3600 + r * 5400;
    const w = { granularity: "daily" as const, day, device: { brand: "WHOOP", model: "WHOOP 5.0", kind: "band" } };
    await whoop.observation({ ...w, metric: "recovery_score", value: Math.round(40 + r * 55), externalId: `r:${day}` });
    await whoop.observation({ ...w, metric: "hrv_rmssd", value: hrv, externalId: `hrv:${day}` });
    await whoop.observation({ ...w, metric: "resting_hr", value: rhr, externalId: `rhr:${day}` });
    await whoop.observation({ ...w, metric: "strain", value: 6 + r * 12, externalId: `strain:${day}` });
    await whoop.observation({ ...w, metric: "sleep_duration", value: sleep, granularity: "session", externalId: `sleep:${day}` });
    // Oura disagrees on HRV every 7th day to demonstrate conflicts.
    const o = { granularity: "daily" as const, day, device: { brand: "Oura", model: "Oura Ring 4", kind: "ring" } };
    await oura.observation({ ...o, metric: "hrv_rmssd", value: i % 7 === 0 ? hrv * 1.35 : hrv * 1.03, externalId: `hrv:${day}` });
    await oura.observation({ ...o, metric: "readiness_score", value: Math.round(60 + r * 35), externalId: `ready:${day}` });
    await oura.observation({ ...o, metric: "sleep_duration", value: sleep * (0.97 + rand(i + 99) * 0.06), granularity: "session", externalId: `sleep:${day}` });
    await oura.observation({ ...o, metric: "steps", value: Math.round(6000 + r * 8000), externalId: `steps:${day}` });
    await polar.observation({ granularity: "daily", day, metric: "hrv_rmssd", value: hrv * 0.98, externalId: `hrv:${day}` });

    if (i % 2 === 0) {
      // Zwift ride relayed through Strava, also seen by WHOOP.
      const start = new Date(`${day}T12:30:00Z`);
      const secs = 3600 + Math.round(r * 1800);
      const watts = Array.from({ length: secs / 5 }, (_, k) => Math.round(190 + Math.sin(k / 20) * 40 + rand(k) * 25));
      const hr = watts.map((p, k) => Math.round(120 + p / 6 + Math.sin(k / 50) * 5));
      const id = await strava.activity({
        externalId: `ride-${day}`,
        name: i % 4 === 0 ? "Zwift - Watopia Hilly Route" : "Zwift - Tempo Intervals",
        sportRaw: "VirtualRide",
        startTime: start,
        endTime: new Date(start.getTime() + secs * 1000),
        movingSeconds: secs,
        elapsedSeconds: secs,
        distanceM: secs * 9.2,
        elevationGainM: 300 + r * 400,
        avgPower: 200 + r * 30,
        normalizedPower: 215 + r * 30,
        avgCadence: 88,
        avgHr: 148 + r * 6,
        maxHr: 172,
        calories: 750 + r * 200,
        origin: "Zwift",
        device: { model: "Zwift", kind: "app" },
      });
      await strava.streams(id, { time: watts.map((_, k) => k * 5), watts, heartrate: hr, cadence: watts.map(() => 85 + Math.round(rand(i) * 8)) });
      await whoop.activity({
        externalId: `w-${day}`,
        name: "WHOOP Cycling",
        sportRaw: "Cycling",
        startTime: new Date(start.getTime() + 60_000),
        endTime: new Date(start.getTime() + secs * 1000 - 60_000),
        elapsedSeconds: secs - 120,
        avgHr: i % 6 === 0 ? 139 : 147 + r * 6, // optical vs chest strap disagreement
        maxHr: 170,
        calories: 820 + r * 150,
        strain: 12 + r * 4,
        device: { brand: "WHOOP", model: "WHOOP 5.0", kind: "band" },
      });
    }
  }
  for (const ing of [whoop, oura, polar, strava]) await ing.finalize();
  console.log(`seeded ${EMAIL} / demo-password`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
