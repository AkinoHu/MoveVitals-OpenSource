import { asc, eq, getTableColumns, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  activities,
  activityGroups,
  activityStreams,
  aiSettings,
  authAccounts,
  connections,
  dailyMetrics,
  dailyOverrides,
  devices,
  labReports,
  labResults,
  observations,
  rawRecords,
  sourcePriorities,
  syncRuns,
  userAttributes,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Full data export (GDPR / PIPL data portability): every table that holds the
// user's data. Credentials are never exported (password hash, sessions, API
// tokens, provider tokens, the AI API key, encrypted report files).
//
// The JSON is streamed table by table in pages, so a large history does not
// have to fit in memory.
const PAGE = 2000;
const STREAM_PAGE = 200; // streams are large JSON arrays

type Page = (offset: number) => Promise<unknown[]>;

function paged(table: PgTable, where: SQL, order: AnyPgColumn[], pick?: Record<string, AnyPgColumn>): Page {
  return (offset) => {
    const q = pick ? db.select(pick).from(table) : db.select().from(table);
    return q.where(where).orderBy(...order.map((c) => asc(c))).limit(PAGE).offset(offset);
  };
}

export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const uid = user.id;

  const omit = <T extends PgTable>(table: T, ...drop: string[]) => Object.fromEntries(Object.entries(getTableColumns(table)).filter(([k]) => !drop.includes(k))) as Record<string, AnyPgColumn>;

  const sections: [string, Page][] = [
    ["authAccounts", paged(authAccounts, eq(authAccounts.userId, uid), [authAccounts.id], { id: authAccounts.id, provider: authAccounts.provider, email: authAccounts.email, createdAt: authAccounts.createdAt })],
    ["attributes", paged(userAttributes, eq(userAttributes.userId, uid), [userAttributes.key])],
    [
      "connections",
      paged(connections, eq(connections.userId, uid), [connections.id], {
        id: connections.id,
        provider: connections.provider,
        displayName: connections.displayName,
        status: connections.status,
        lastSyncAt: connections.lastSyncAt,
        createdAt: connections.createdAt,
      }),
    ],
    [
      "syncRuns",
      (offset) =>
        db
          .select(getTableColumns(syncRuns))
          .from(syncRuns)
          .innerJoin(connections, eq(connections.id, syncRuns.connectionId))
          .where(eq(connections.userId, uid))
          .orderBy(asc(syncRuns.id))
          .limit(PAGE)
          .offset(offset),
    ],
    ["devices", paged(devices, eq(devices.userId, uid), [devices.id])],
    ["observations", paged(observations, eq(observations.userId, uid), [observations.id])],
    ["dailyMetrics", paged(dailyMetrics, eq(dailyMetrics.userId, uid), [dailyMetrics.day, dailyMetrics.metric])],
    ["dailyOverrides", paged(dailyOverrides, eq(dailyOverrides.userId, uid), [dailyOverrides.day, dailyOverrides.metric])],
    ["sourcePriorities", paged(sourcePriorities, eq(sourcePriorities.userId, uid), [sourcePriorities.scope])],
    ["activities", paged(activities, eq(activities.userId, uid), [activities.id])],
    ["activityGroups", paged(activityGroups, eq(activityGroups.userId, uid), [activityGroups.id])],
    [
      "activityStreams",
      (offset) =>
        db
          .select(getTableColumns(activityStreams))
          .from(activityStreams)
          .innerJoin(activities, eq(activities.id, activityStreams.activityId))
          .where(eq(activities.userId, uid))
          .orderBy(asc(activityStreams.activityId))
          .limit(STREAM_PAGE)
          .offset(offset),
    ],
    ["rawRecords", paged(rawRecords, eq(rawRecords.userId, uid), [rawRecords.id])],
    ["labResults", paged(labResults, eq(labResults.userId, uid), [labResults.id])],
    // Report files are left out (download them from Body Lab); metadata only.
    ["labReports", paged(labReports, eq(labReports.userId, uid), [labReports.id], omit(labReports, "fileEnc"))],
    // The AI settings without the API key.
    ["aiSettings", paged(aiSettings, eq(aiSettings.userId, uid), [aiSettings.userId], omit(aiSettings, "apiKeyEnc"))],
  ];

  const { passwordHash: _omit, ...safeUser } = user as typeof user & { passwordHash?: unknown };
  void _omit;
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(`{"exportedAt":${JSON.stringify(new Date())},"user":${JSON.stringify(safeUser)}`));
        for (const [name, page] of sections) {
          const size = name === "activityStreams" ? STREAM_PAGE : PAGE;
          controller.enqueue(enc.encode(`,\n${JSON.stringify(name)}:[`));
          let first = true;
          for (let offset = 0; ; offset += size) {
            const rows = await page(offset);
            if (rows.length) {
              controller.enqueue(enc.encode((first ? "" : ",") + rows.map((r) => JSON.stringify(r)).join(",\n")));
              first = false;
            }
            if (rows.length < size) break;
          }
          controller.enqueue(enc.encode("]"));
        }
        controller.enqueue(enc.encode("}\n"));
        controller.close();
      } catch (e) {
        console.error("[export] failed", e);
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="movevitals-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
