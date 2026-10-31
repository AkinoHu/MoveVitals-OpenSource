import { and, count, desc, eq, gte, max } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { setDailyOverride } from "@/app/actions";
import { Legend, LineChart, type Series } from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { PriorityEditor } from "@/components/priority-editor";
import { Badge, Card, ConflictBadge, SourceBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dailyMetrics, devices, observations, rawRecords } from "@/lib/db/schema";
import { fill, getDict, toLocale } from "@/i18n";
import { METRICS, METRIC_MAP, formatMetric, type MetricCategory } from "@/lib/metrics";
import { providerName } from "@/lib/providers/catalog";
import { DEFAULT_ACTIVITY_PRIORITY, DEFAULT_CATEGORY_PRIORITY, loadPriorities } from "@/lib/resolve";
import { addDays, dayInTz } from "@/lib/time";

export const metadata: Metadata = { title: "Data & sources" };

const CHART_DAYS = 90;
const CATEGORY_ORDER: MetricCategory[] = ["recovery", "heart", "sleep", "activity", "body", "vitals", "metabolic"];

const ACTIVITY_SCOPES = [
  ["activity.avgHr", "actHr"],
  ["activity.avgPower", "actPower"],
  ["activity.distanceM", "actGps"],
  ["activity.calories", "actCal"],
  ["activity.name", "actName"],
] as const;


export default async function DataPage({ params, searchParams }: PageProps<"/[locale]/dashboard/data">) {
  const t = getDict(toLocale((await params).locale));
  const d = t.dash.data;
  const ml = (code: string) => t.metrics[code as keyof typeof t.metrics] ?? code;
  const user = await requireUser();
  const sp = await searchParams;
  const metric = typeof sp.metric === "string" && METRIC_MAP[sp.metric] ? sp.metric : null;
  const onlyConflicts = sp.conflicts === "1";

  const where = [eq(dailyMetrics.userId, user.id)];
  if (metric) where.push(eq(dailyMetrics.metric, metric));
  if (onlyConflicts) where.push(eq(dailyMetrics.hasConflict, true));

  const [rows, prio, sources, devs] = await Promise.all([
    db
      .select()
      .from(dailyMetrics)
      .where(and(...where))
      .orderBy(desc(dailyMetrics.day), dailyMetrics.metric)
      .limit(300),
    loadPriorities(user.id),
    db
      .select({ provider: rawRecords.provider, records: count(), last: max(rawRecords.fetchedAt) })
      .from(rawRecords)
      .where(eq(rawRecords.userId, user.id))
      .groupBy(rawRecords.provider),
    db.select().from(devices).where(eq(devices.userId, user.id)).orderBy(desc(devices.lastSeenAt)),
  ]);
  // Only offer filters for metrics this user actually has.
  const available = new Set(
    (await db.selectDistinct({ metric: dailyMetrics.metric }).from(dailyMetrics).where(eq(dailyMetrics.userId, user.id))).map((r) => r.metric),
  );
  const obsCounts = await db
    .select({ provider: observations.provider, n: count() })
    .from(observations)
    .where(eq(observations.userId, user.id))
    .groupBy(observations.provider);
  const obsBy = new Map(obsCounts.map((o) => [o.provider, o.n]));

  // Per-source history of the selected metric (oldest → newest).
  let chart: { days: string[]; series: Series[]; conflictDays: number } | null = null;
  if (metric) {
    const today = dayInTz(new Date(), user.timezone);
    const days = Array.from({ length: CHART_DAYS }, (_, i) => addDays(today, i - CHART_DAYS + 1));
    const hist = await db
      .select()
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, user.id), eq(dailyMetrics.metric, metric), gte(dailyMetrics.day, days[0])));
    const byDay = new Map(hist.map((h) => [h.day, h]));
    const providers = [...new Set(hist.flatMap((h) => h.candidates.map((c) => c.provider)))];
    chart = {
      days,
      conflictDays: hist.filter((h) => h.hasConflict).length,
      series: [
        { key: "selected", label: d.selected, values: days.map((d) => byDay.get(d)?.value ?? null), tone: "accent" },
        ...(providers.length > 1
          ? providers.map((p): Series => ({
              key: p,
              label: providerName(p),
              values: days.map((d) => byDay.get(d)?.candidates.find((c) => c.provider === p)?.value ?? null),
              tone: "faint",
              dashed: true,
            }))
          : []),
      ],
    };
  }

  const filterLink = (params: Record<string, string | null>) => {
    const qs = new URLSearchParams();
    const next = { metric, conflicts: onlyConflicts ? "1" : null, ...params };
    for (const [k, v] of Object.entries(next)) if (v) qs.set(k, v);
    return `/dashboard/data${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title={d.title}
        description={d.desc}
      />

      {metric && chart && (
        <Card
          className="mb-6"
          title={fill(d.chartTitle, { m: ml(metric), n: CHART_DAYS })}
          action={chart.conflictDays > 0 ? <span className="text-xs text-warn">{fill(d.conflictDays, { n: chart.conflictDays })}</span> : undefined}
        >
          <LineChart days={chart.days} metric={metric} series={chart.series} height={260} />
          <div className="mt-3">
            <Legend items={[{ label: d.selected, tone: "accent" }, ...(chart.series.length > 1 ? [{ label: d.rawSources, tone: "faint" as const, dashed: true }] : [])]} />
          </div>
        </Card>
      )}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_400px] [&>*]:min-w-0">
        <Card
          title={d.daily}
          action={
            <div className="flex items-center gap-2 text-xs">
              <Link href={filterLink({ conflicts: onlyConflicts ? null : "1" })} className={onlyConflicts ? "text-warn" : "text-muted hover:text-ink"}>
                {onlyConflicts ? `✓ ${d.onlyConflicts}` : d.onlyConflicts}
              </Link>
              {metric && (
                <Link href={filterLink({ metric: null })} className="text-muted hover:text-ink">
                  {fill(d.clearFilter, { m: ml(metric) })}
                </Link>
              )}
            </div>
          }
        >
          <div className="mb-4 space-y-2">
            {CATEGORY_ORDER.map((cat) => {
              const list = METRICS.filter((m) => m.category === cat && (available.size === 0 || available.has(m.code)));
              if (list.length === 0) return null;
              return (
                <div key={cat} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="w-20 shrink-0 text-[11px] font-medium text-faint">{t.categories[cat]}</span>
                  <div className="flex flex-1 flex-wrap gap-1">
                    {list.map((m) => (
                      <Link
                        key={m.code}
                        href={filterLink({ metric: m.code })}
                        className={`rounded-md px-2 py-0.5 text-[11.5px] transition ${metric === m.code ? "bg-ink text-bg" : "bg-surface-2 text-muted hover:text-ink"}`}
                      >
                        {ml(m.code)}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{d.none}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">{d.colDate}</th>
                    <th className="py-2 pr-3 font-medium">{d.colMetric}</th>
                    <th className="py-2 pr-3 font-medium">{d.colValue}</th>
                    <th className="py-2 font-medium">{d.colSources}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.day}-${r.metric}`} className="border-t border-line align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">{r.day}</td>
                      <td className="py-2 pr-3">
                        {ml(r.metric)}
                        {r.hasConflict && (
                          <span className="ml-1">
                            <ConflictBadge label={t.common.conflict} />
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="font-medium tabular-nums">{formatMetric(r.metric, r.value, user.units)}</span>
                        <span className="ml-1 text-[11px] text-muted">{d.method[r.method as keyof typeof d.method]}</span>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.candidates.map((c) => {
                            const selected = c.provider === r.selectedProvider;
                            return (
                              <form key={c.provider} action={setDailyOverride}>
                                <input type="hidden" name="day" value={r.day} />
                                <input type="hidden" name="metric" value={r.metric} />
                                <input type="hidden" name="provider" value={selected && r.method === "manual" ? "" : c.provider} />
                                <button
                                  disabled={r.candidates.length === 1}
                                  title={selected && r.method === "manual" ? d.unpin : fill(d.useSource, { p: providerName(c.provider) })}
                                  className={`rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums ${selected ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}
                                >
                                  {providerName(c.provider)} {formatMetric(r.metric, c.value, user.units)}
                                </button>
                              </form>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title={d.priorities}>
            {(Object.keys(DEFAULT_CATEGORY_PRIORITY) as MetricCategory[]).map((cat) => (
              <PriorityEditor key={cat} scope={cat} label={t.categories[cat]} order={prio.get(cat) ?? DEFAULT_CATEGORY_PRIORITY[cat]} custom={prio.has(cat)} />
            ))}
            {ACTIVITY_SCOPES.map(([scope, key]) => (
              <PriorityEditor
                key={scope}
                scope={scope}
                label={d[key]}
                order={prio.get(scope) ?? DEFAULT_ACTIVITY_PRIORITY[scope.split(".")[1] as keyof typeof DEFAULT_ACTIVITY_PRIORITY]}
                custom={prio.has(scope)}
              />
            ))}
          </Card>

          <Card title={d.sources}>
            {sources.length === 0 ? (
              <p className="text-sm text-muted">{d.noData}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {sources.map((s) => (
                  <li key={s.provider} className="flex items-center justify-between gap-2">
                    <SourceBadge provider={s.provider} />
                    <span className="text-xs text-muted tabular-nums">
                      {fill(d.rawCount, { a: s.records, b: obsBy.get(s.provider) ?? 0 })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={d.devices}>
            {devs.length === 0 ? (
              <p className="text-sm text-muted">{d.none2}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {devs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span>
                      {d.brand ? `${d.brand} ` : ""}
                      {d.model}
                    </span>
                    {d.kind && <Badge>{d.kind}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
