import { and, desc, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";
import { Legend, LineChart, StackedBars, type Series } from "@/components/charts";
import { LabAlertsCard } from "@/components/lab";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, Card, ConflictBadge, Empty, SourceBadge, StatStrip } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { activityGroups, connections, dailyMetrics } from "@/lib/db/schema";
import { fill, getDict, toLocale } from "@/i18n";
import { INTL_LOCALE } from "@/i18n/config";
import { alertsFrom, baselinesFor } from "@/lib/lab/baseline";
import { formatMetric } from "@/lib/metrics";
import { formatDistance } from "@/lib/units";
import { providerName } from "@/lib/providers/catalog";
import type { Sport } from "@/lib/sports";
import { addDays, dayInTz, formatDuration } from "@/lib/time";

const DAYS = 30;
const WEEKS = 12;
const HEADLINE = ["recovery_score", "readiness_score", "hrv_rmssd", "resting_hr", "sleep_duration", "strain", "steps", "weight", "body_battery"];
const SLEEP = ["sleep_deep", "sleep_rem", "sleep_light", "sleep_awake"];

type Row = typeof dailyMetrics.$inferSelect;

function stats(values: (number | null)[]) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 7) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean, lo: mean - sd, hi: mean + sd };
}

export default async function Overview({ params }: PageProps<"/[locale]/dashboard">) {
  const locale = toLocale((await params).locale);
  const t = getDict(locale);
  const o = t.dash.overview;
  const user = await requireUser();
  const today = dayInTz(new Date(), user.timezone);
  const from = addDays(today, -DAYS + 1);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  // Monday-based weeks in the user's timezone, oldest first.
  const weekStart = (d: Date) => {
    const day = dayInTz(d, user.timezone);
    return addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  };
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(weekStart(new Date()), -(WEEKS - 1 - i) * 7));

  const [conns, daily, groups, base] = await Promise.all([
    db.select({ id: connections.id }).from(connections).where(eq(connections.userId, user.id)),
    db
      .select()
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, user.id), gte(dailyMetrics.day, from), inArray(dailyMetrics.metric, [...HEADLINE, ...SLEEP]))),
    db
      .select()
      .from(activityGroups)
      .where(and(eq(activityGroups.userId, user.id), gte(activityGroups.startTime, new Date(`${addDays(weeks[0], -1)}T00:00:00Z`))))
      .orderBy(desc(activityGroups.startTime)),
    baselinesFor(user.id, user.timezone),
  ]);
  const alerts = alertsFrom(base.baselines);

  if (conns.length === 0) {
    return (
      <>
        <PageHeader title={o.title} />
        <Empty title={o.emptyTitle}>
          <p>{o.emptyBody}</p>
          <ButtonLink href="/dashboard/connections" className="mt-5">
            {o.emptyCta}
          </ButtonLink>
        </Empty>
      </>
    );
  }

  const byMetric = new Map<string, Map<string, Row>>();
  for (const d of daily) {
    const m = byMetric.get(d.metric) ?? new Map<string, Row>();
    m.set(d.day, d);
    byMetric.set(d.metric, m);
  }
  const selected = (metric: string) => days.map((d) => byMetric.get(metric)?.get(d)?.value ?? null);
  const latest = (metric: string) => {
    const m = byMetric.get(metric);
    if (!m) return null;
    const day = [...m.keys()].sort().at(-1)!;
    return m.get(day)!;
  };

  // Per-source lines for one metric, the selected value drawn in orange.
  const sourceSeries = (metric: string): Series[] => {
    const rows = byMetric.get(metric);
    const providers = new Set<string>();
    rows?.forEach((r) => r.candidates.forEach((c) => providers.add(c.provider)));
    const out: Series[] = [{ key: "selected", label: o.selected, values: selected(metric), tone: "accent" }];
    if (providers.size > 1)
      for (const p of providers)
        out.push({ key: p, label: providerName(p), values: days.map((d) => rows?.get(d)?.candidates.find((c) => c.provider === p)?.value ?? null), tone: "faint", dashed: true });
    return out;
  };

  const headline = HEADLINE.filter((m) => byMetric.has(m)).slice(0, 6);
  const conflicts = daily.filter((d) => d.hasConflict).length;
  const hrv = selected("hrv_rmssd");
  const hrvBand = stats(hrv);
  const recoveryMetric = byMetric.has("recovery_score") ? "recovery_score" : byMetric.has("readiness_score") ? "readiness_score" : null;
  const hasSleepStages = SLEEP.some((m) => byMetric.has(m));

  // Weekly training time by sport family.
  const vol = { ride: weeks.map(() => 0), run: weeks.map(() => 0), other: weeks.map(() => 0) };
  for (const g of groups) {
    const wi = weeks.indexOf(weekStart(g.startTime));
    if (wi < 0) continue;
    const secs = Number(g.merged.movingSeconds?.value ?? g.merged.elapsedSeconds?.value ?? (g.endTime.getTime() - g.startTime.getTime()) / 1000);
    const fam = g.sport.includes("ride") ? "ride" : g.sport.includes("run") ? "run" : "other";
    vol[fam][wi] += secs / 3600;
  }

  return (
    <>
      <PageHeader
        title={o.title}
        description={fill(o.desc, { n: DAYS })}
        action={
          conflicts > 0 ? (
            <Link href="/dashboard/data?conflicts=1" className="text-[13px] text-warn hover:underline">
              {fill(o.conflicts, { n: conflicts })}
            </Link>
          ) : null
        }
      />

      <LabAlertsCard alerts={alerts} t={t} />

      {headline.length > 0 && (
        <StatStrip
          items={headline.map((m) => {
            const r = latest(m)!;
            return {
              label: t.metrics[m as keyof typeof t.metrics],
              value: formatMetric(m, r.value, user.units),
              sub: `${providerName(r.selectedProvider)}${r.candidates.length > 1 ? ` · ${fill(t.common.sources, { n: r.candidates.length })}` : ""}${r.day !== today ? ` · ${r.day.slice(5)}` : ""}`,
              highlight: r.hasConflict,
            };
          })}
        />
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        {byMetric.has("hrv_rmssd") && (
          <Card
            title={o.hrvCard}
            action={
              <Link href="/dashboard/data?metric=hrv_rmssd" className="text-xs text-muted hover:text-ink">
                {t.common.details}
              </Link>
            }
          >
            <LineChart days={days} metric="hrv_rmssd" series={sourceSeries("hrv_rmssd")} band={hrvBand} baselineLabel={o.baseline} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Legend items={[{ label: o.selected, tone: "accent" }, { label: o.otherSources, tone: "faint", dashed: true }]} />
              {hrvBand && <span className="tnum text-[11.5px] text-muted">{fill(o.mean30, { v: formatMetric("hrv_rmssd", hrvBand.mean) })}</span>}
            </div>
          </Card>
        )}

        {(byMetric.has("resting_hr") || recoveryMetric) && (
          <Card title={recoveryMetric ? fill(o.andRhr, { a: t.metrics[recoveryMetric as keyof typeof t.metrics] }) : o.rhr}>
            {recoveryMetric && (
              <>
                <LineChart days={days} metric={recoveryMetric} height={150} series={[{ key: "r", label: t.metrics[recoveryMetric as keyof typeof t.metrics], values: selected(recoveryMetric), tone: "ink", dots: true }]} />
                <div className="my-3 border-t border-line" />
              </>
            )}
            {byMetric.has("resting_hr") && (
              <LineChart
                days={days}
                metric="resting_hr"
                height={recoveryMetric ? 130 : 220}
                band={stats(selected("resting_hr"))}
                baselineLabel={o.baseline}
                series={[{ key: "rhr", label: o.rhr, values: selected("resting_hr"), tone: "accent" }]}
              />
            )}
          </Card>
        )}

        {(hasSleepStages || byMetric.has("sleep_duration")) && (
          <Card title={o.sleepCard}>
            {hasSleepStages ? (
              <>
                <StackedBars
                  days={days}
                  metric="sleep_duration"
                  stacks={[
                    { key: "deep", label: o.deep, values: selected("sleep_deep"), tone: "ink" },
                    { key: "rem", label: o.rem, values: selected("sleep_rem"), tone: "accent" },
                    { key: "light", label: o.light, values: selected("sleep_light"), tone: "ink-3" },
                    { key: "awake", label: o.awake, values: selected("sleep_awake"), tone: "ink-2" },
                  ]}
                />
                <div className="mt-3">
                  <Legend
                    items={[
                      { label: o.deep, tone: "ink", swatch: "box" },
                      { label: o.rem, tone: "accent", swatch: "box" },
                      { label: o.light, tone: "ink-3", swatch: "box" },
                      { label: o.awake, tone: "ink-2", swatch: "box" },
                    ]}
                  />
                </div>
              </>
            ) : (
              <LineChart days={days} metric="sleep_duration" series={sourceSeries("sleep_duration")} />
            )}
          </Card>
        )}

        <Card title={fill(o.volume, { n: WEEKS })}>
          {groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">{o.noActivities}</p>
          ) : (
            <>
              <StackedBars
                days={weeks}
                unit="h"
                stacks={[
                  { key: "ride", label: o.ride, values: vol.ride, tone: "accent" },
                  { key: "run", label: o.run, values: vol.run, tone: "ink" },
                  { key: "other", label: o.other, values: vol.other, tone: "ink-3" },
                ]}
              />
              <div className="mt-3">
                <Legend
                  items={[
                    { label: o.ride, tone: "accent", swatch: "box" },
                    { label: o.run, tone: "ink", swatch: "box" },
                    { label: o.other, tone: "ink-3", swatch: "box" },
                  ]}
                />
              </div>
            </>
          )}
        </Card>
      </div>

      <Card title={o.recent} className="mt-6" flush action={<Link href="/dashboard/activities" className="text-xs text-muted hover:text-ink">{t.common.viewAll}</Link>}>
        {groups.length === 0 ? (
          <p className="p-5 text-sm text-muted">{o.noActivities}</p>
        ) : (
          <ul className="divide-y divide-line">
            {groups.slice(0, 8).map((g) => (
              <li key={g.id}>
                <Link href={`/dashboard/activities/${g.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm transition hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="font-medium">{g.name ?? t.sports[g.sport as Sport]}</span>
                    <span className="ml-2 text-xs text-muted">
                      {g.startTime.toLocaleString(INTL_LOCALE[locale], { timeZone: user.timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {t.sports[g.sport as Sport]}
                    </span>
                  </span>
                  <span className="tnum flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs whitespace-nowrap text-muted">
                    {g.merged.distanceM?.value != null && <span>{formatDistance(Number(g.merged.distanceM.value), user.units)}</span>}
                    <span>{formatDuration(Number(g.merged.movingSeconds?.value ?? g.merged.elapsedSeconds?.value ?? 0))}</span>
                    {g.merged.avgPower?.value != null && <span>{Math.round(Number(g.merged.avgPower.value))} W</span>}
                    {g.merged.avgHr?.value != null && <span>{Math.round(Number(g.merged.avgHr.value))} bpm</span>}
                    {g.merged.name?.provider && <SourceBadge provider={g.merged.name.provider} />}
                    {g.memberCount > 1 && <span className="rounded border border-line px-1.5">{fill(t.common.sources, { n: g.memberCount })}</span>}
                    {g.hasConflict && <ConflictBadge label={t.common.conflict} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
