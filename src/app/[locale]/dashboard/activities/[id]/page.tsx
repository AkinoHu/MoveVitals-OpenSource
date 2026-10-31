import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { detachActivity, pinActivity } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StreamChart } from "@/components/stream-chart";
import { Badge, Button, Card, ConflictBadge, SourceBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { activities, activityGroups, activityStreams } from "@/lib/db/schema";
import { ACTIVITY_FIELDS, type ActivityField } from "@/lib/resolve";
import type { Sport } from "@/lib/sports";
import { fill, getDict, toLocale, type Dict } from "@/i18n";
import { INTL_LOCALE } from "@/i18n/config";
import { formatDuration } from "@/lib/time";
import { formatDistance, formatElevation, formatSpeed, type UnitSystem } from "@/lib/units";



function fmt(field: ActivityField, v: unknown, t: Dict, units: UnitSystem): string {
  if (v == null) return "—";
  if (typeof v === "string") return field === "sport" ? (t.sports[v as Sport] ?? v) : v;
  const n = Number(v);
  switch (field) {
    case "distanceM":
      return formatDistance(n, units, 2);
    case "elevationGainM":
      return formatElevation(n, units);
    case "movingSeconds":
    case "elapsedSeconds":
      return formatDuration(n);
    case "avgHr":
    case "maxHr":
      return `${Math.round(n)} bpm`;
    case "avgPower":
    case "normalizedPower":
      return `${Math.round(n)} W`;
    case "avgCadence":
      return `${Math.round(n)} rpm`;
    case "avgSpeed":
      return formatSpeed(n, units);
    case "calories":
      return `${Math.round(n)} kcal`;
    default:
      return n.toFixed(1);
  }
}

export default async function ActivityDetail({ params }: PageProps<"/[locale]/dashboard/activities/[id]">) {
  const { id, locale: rawLocale } = await params;
  const locale = toLocale(rawLocale);
  const t = getDict(locale);
  const a = t.dash.activities;
  const user = await requireUser();
  const [group] = await db.select().from(activityGroups).where(and(eq(activityGroups.id, id), eq(activityGroups.userId, user.id)));
  if (!group) notFound();
  const members = await db.select().from(activities).where(eq(activities.groupId, id));
  const streams = members.length
    ? await db
        .select()
        .from(activityStreams)
        .where(
          inArray(
            activityStreams.activityId,
            members.map((m) => m.id),
          ),
        )
    : [];
  const stream = streams[0];
  const fields = ACTIVITY_FIELDS.filter((f) => f !== "name" && members.some((m) => m[f] != null));

  return (
    <>
      <PageHeader
        title={group.name ?? t.sports[group.sport as Sport]}
        description={`${group.startTime.toLocaleString(INTL_LOCALE[locale], { timeZone: user.timezone })} · ${t.sports[group.sport as Sport]} · ${fill(a.sources, { n: members.length })}`}
        action={group.hasConflict ? <ConflictBadge label={t.common.conflict} /> : undefined}
      />

      {stream && (
        <Card title={a.streams} className="mb-6" action={<SourceBadge provider={members.find((m) => m.id === stream.activityId)!.provider} />}>
          <StreamChart streams={stream.streams as Record<string, number[]>} />
        </Card>
      )}

      <Card title={a.compare} action={<span className="text-xs text-muted">{a.compareHint}</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pr-4 font-medium">{a.field}</th>
                {members.map((m) => (
                  <th key={m.id} className="py-2 pr-4 font-medium">
                    <SourceBadge provider={m.provider} origin={m.origin} />
                    {group.manualPrimaryActivityId === m.id && <span className="ml-1"><Badge tone="good">{a.locked}</Badge></span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f} className="border-t border-line">
                  <td className="py-2 pr-4 text-muted">{a.fields[f]}</td>
                  {members.map((m) => {
                    const chosen = group.merged[f]?.activityId === m.id;
                    return (
                      <td key={m.id} className={`py-2 pr-4 tabular-nums ${chosen ? "font-semibold text-accent" : m[f] == null ? "text-muted" : ""}`}>
                        {fmt(f, m[f], t, user.units)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {members.length > 1 && (
                <tr className="border-t border-line">
                  <td className="py-3 pr-4 text-xs text-muted">{a.actions}</td>
                  {members.map((m) => (
                    <td key={m.id} className="space-y-1 py-3 pr-4">
                      <form action={pinActivity}>
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="activityId" value={group.manualPrimaryActivityId === m.id ? "" : m.id} />
                        <Button variant="secondary" className="text-xs">
                          {group.manualPrimaryActivityId === m.id ? a.unlock : a.useThis}
                        </Button>
                      </form>
                      <form action={detachActivity}>
                        <input type="hidden" name="activityId" value={m.id} />
                        <Button variant="ghost" className="px-0 text-xs">
                          {a.split}
                        </Button>
                      </form>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">{a.rules}</p>
      </Card>
    </>
  );
}
