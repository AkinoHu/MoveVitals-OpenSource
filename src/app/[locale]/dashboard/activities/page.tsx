import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { DateJump } from "@/components/date-jump";
import { PageHeader } from "@/components/page-header";
import { SportBadge, SportIcon } from "@/components/sport-icon";
import { ConflictBadge, Empty, SourceBadge } from "@/components/ui";
import { fill, getDict, toLocale, type Dict } from "@/i18n";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { activities, activityGroups, dailyMetrics } from "@/lib/db/schema";
import { formatMetric } from "@/lib/metrics";
import type { Sport } from "@/lib/sports";
import {
  CALENDAR_MAX,
  CALENDAR_MIN,
  addDays,
  addMonths,
  clampDay,
  dayInTz,
  daysBetween,
  formatDuration,
  isDay,
  monthEnd,
  monthStart,
  weekStart,
} from "@/lib/time";
import { formatDistance, type UnitSystem } from "@/lib/units";

export const metadata: Metadata = { title: "Activities" };

type Group = typeof activityGroups.$inferSelect;
type Mode = "day" | "week" | "month" | "year";
const MODES: Mode[] = ["day", "week", "month", "year"];

const seconds = (g: Group) => Number(g.merged.movingSeconds?.value ?? g.merged.elapsedSeconds?.value ?? (g.endTime.getTime() - g.startTime.getTime()) / 1000);
const meters = (g: Group) => (g.merged.distanceM?.value != null ? Number(g.merged.distanceM.value) : 0);
const hours = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);

function utc(day: string) {
  return new Date(`${day}T00:00:00Z`);
}

// Visible range for a mode around an anchor day.
function rangeFor(mode: Mode, anchor: string): { from: string; to: string } {
  if (mode === "day") return { from: anchor, to: anchor };
  if (mode === "week") return { from: weekStart(anchor), to: addDays(weekStart(anchor), 6) };
  if (mode === "month") return { from: weekStart(monthStart(anchor)), to: addDays(weekStart(monthEnd(anchor)), 6) };
  return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
}

function step(mode: Mode, anchor: string, dir: 1 | -1): string {
  if (mode === "day") return addDays(anchor, dir);
  if (mode === "week") return addDays(anchor, 7 * dir);
  if (mode === "month") return addMonths(anchor, dir);
  return `${Number(anchor.slice(0, 4)) + dir}${anchor.slice(4)}`;
}

function periodTitle(mode: Mode, anchor: string, locale: Locale): string {
  const L = INTL_LOCALE[locale];
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(L, { ...o, timeZone: "UTC" }).format(utc(d));
  if (mode === "day") return f(anchor, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  if (mode === "month") return f(anchor, { year: "numeric", month: "long" });
  if (mode === "year") return f(anchor, { year: "numeric" });
  const from = weekStart(anchor);
  return new Intl.DateTimeFormat(L, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).formatRange(utc(from), utc(addDays(from, 6)));
}

function Segmented({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={`rounded-md px-3 py-1 text-[12.5px] transition ${i.active ? "bg-ink font-medium text-bg" : "text-muted hover:text-ink"}`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

function WorkoutChip({ g, t, units }: { g: Group; t: Dict; units: UnitSystem }) {
  const d = meters(g);
  return (
    <Link
      href={`/dashboard/activities/${g.id}`}
      title={`${g.name ?? t.sports[g.sport as Sport]} · ${hours(seconds(g))}${d ? ` · ${formatDistance(d, units)}` : ""}`}
      className="flex min-w-0 items-center gap-1.5 rounded-md bg-surface-2 px-1.5 py-1 text-[11px] text-ink transition hover:bg-surface-3"
    >
      <SportIcon sport={g.sport} size={13} className="text-muted" />
      <span className="tnum truncate">{hours(seconds(g))}</span>
      {d > 0 && <span className="tnum hidden truncate text-faint xl:inline">{formatDistance(d, units)}</span>}
    </Link>
  );
}

function WorkoutCard({ g, t, units, tz, locale }: { g: Group; t: Dict; units: UnitSystem; tz: string; locale: Locale }) {
  const f = g.merged;
  return (
    <Link href={`/dashboard/activities/${g.id}`} className="block rounded-lg border border-line bg-surface p-3 transition hover:border-line-strong">
      <div className="flex items-start gap-2.5">
        <SportBadge sport={g.sport} size={28} />
        <div className="min-w-0">
          <p className="line-clamp-2 text-[13px] leading-snug font-medium break-words">{g.name ?? t.sports[g.sport as Sport]}</p>
          <p className="tnum text-[11px] text-muted">
            {g.startTime.toLocaleTimeString(INTL_LOCALE[locale], { timeZone: tz, hour: "2-digit", minute: "2-digit" })} · {t.sports[g.sport as Sport]}
          </p>
        </div>
      </div>
      <div className="tnum mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
        <span className="text-ink">{formatDuration(seconds(g))}</span>
        {meters(g) > 0 && <span>{formatDistance(meters(g), units)}</span>}
        {f.avgPower?.value != null && <span>{Math.round(Number(f.avgPower.value))} W</span>}
        {f.avgHr?.value != null && <span>{Math.round(Number(f.avgHr.value))} bpm</span>}
      </div>
    </Link>
  );
}

export default async function ActivitiesPage({ params, searchParams }: PageProps<"/[locale]/dashboard/activities">) {
  const locale = toLocale((await params).locale);
  const t = getDict(locale);
  const a = t.dash.activities;
  const c = a.cal;
  const sp = await searchParams;
  const user = await requireUser();
  const today = dayInTz(new Date(), user.timezone);

  const view = sp.view === "list" ? "list" : "calendar";
  const mode: Mode = MODES.includes(sp.mode as Mode) ? (sp.mode as Mode) : "month";
  const anchor = clampDay(isDay(sp.date) ? sp.date : today);
  const href = (p: Record<string, string>) => `/dashboard/activities?${new URLSearchParams({ view, mode, date: anchor, ...p })}`;

  const header = (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Segmented
        items={[
          { href: href({ view: "calendar" }), label: c.viewCalendar, active: view === "calendar" },
          { href: href({ view: "list" }), label: c.viewList, active: view === "list" },
        ]}
      />
    </div>
  );

  // ---------------------------------------------------------------- list
  if (view === "list") {
    const [groups, members] = await Promise.all([
      db.select().from(activityGroups).where(eq(activityGroups.userId, user.id)).orderBy(desc(activityGroups.startTime)).limit(200),
      db.select({ groupId: activities.groupId, provider: activities.provider, origin: activities.origin }).from(activities).where(eq(activities.userId, user.id)),
    ]);
    const sources = new Map<string, { provider: string; origin: string | null }[]>();
    for (const m of members) if (m.groupId) sources.set(m.groupId, [...(sources.get(m.groupId) ?? []), m]);
    return (
      <>
        <PageHeader title={a.title} description={a.desc} />
        {header}
        {groups.length === 0 ? (
          <Empty title={a.empty} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  {[a.cols.date, a.cols.workout, a.cols.duration, a.cols.distance, a.cols.power, a.cols.hr, a.cols.sources].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const f = g.merged;
                  return (
                    <tr key={g.id} className="border-t border-line hover:bg-surface-2">
                      <td className="tnum px-4 py-2.5 text-muted">
                        {g.startTime.toLocaleString(INTL_LOCALE[locale], { timeZone: user.timezone, year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/dashboard/activities/${g.id}`} className="flex items-center gap-2.5 font-medium hover:text-accent">
                          <SportBadge sport={g.sport} size={26} />
                          <span className="min-w-0">
                            <span className="block truncate">{g.name ?? t.sports[g.sport as Sport]}</span>
                            <span className="block text-xs font-normal text-muted">{t.sports[g.sport as Sport]}</span>
                          </span>
                          {g.hasConflict && <ConflictBadge label={t.common.conflict} />}
                        </Link>
                      </td>
                      <td className="tnum px-4 py-2.5">{formatDuration(seconds(g))}</td>
                      <td className="tnum px-4 py-2.5">{f.distanceM?.value != null ? formatDistance(Number(f.distanceM.value), user.units, 2) : "—"}</td>
                      <td className="tnum px-4 py-2.5">{f.avgPower?.value != null ? `${Math.round(Number(f.avgPower.value))} W` : "—"}</td>
                      <td className="tnum px-4 py-2.5">{f.avgHr?.value != null ? `${Math.round(Number(f.avgHr.value))}` : "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(sources.get(g.id) ?? []).map((s, i) => (
                            <SourceBadge key={i} provider={s.provider} origin={s.origin} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  // ------------------------------------------------------------ calendar
  const { from, to } = rangeFor(mode, anchor);
  // Pad by a day on each side: buckets use the user's local day.
  const groups = await db
    .select()
    .from(activityGroups)
    .where(and(eq(activityGroups.userId, user.id), gte(activityGroups.startTime, utc(addDays(from, -1))), lt(activityGroups.startTime, utc(addDays(to, 2)))))
    .orderBy(activityGroups.startTime);
  const byDay = new Map<string, Group[]>();
  for (const g of groups) {
    const d = dayInTz(g.startTime, user.timezone);
    if (d < from || d > to) continue;
    byDay.set(d, [...(byDay.get(d) ?? []), g]);
  }

  // Totals for the period actually in focus (a month view also shows edge days).
  const focus = mode === "month" ? { from: monthStart(anchor), to: monthEnd(anchor) } : { from, to };
  const inFocus = [...byDay].filter(([d]) => d >= focus.from && d <= focus.to).flatMap(([, gs]) => gs);
  const totalSec = inFocus.reduce((s, g) => s + seconds(g), 0);
  const totalM = inFocus.reduce((s, g) => s + meters(g), 0);
  const bySport = new Map<string, number>();
  for (const g of inFocus) bySport.set(g.sport, (bySport.get(g.sport) ?? 0) + seconds(g));

  const prev = step(mode, anchor, -1);
  const next = step(mode, anchor, 1);
  const canPrev = rangeFor(mode, prev).to >= CALENDAR_MIN && anchor > CALENDAR_MIN;
  const canNext = rangeFor(mode, next).from <= CALENDAR_MAX && anchor < CALENDAR_MAX;
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "short", timeZone: "UTC" }).format(utc(addDays("2024-01-01", i))),
  );
  const navBtn = "grid size-8 place-items-center rounded-md border border-line bg-surface text-muted transition hover:text-ink";

  let body: React.ReactNode;
  if (mode === "month") {
    const days = daysBetween(from, to);
    const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
    body = (
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_64px] border-b border-line text-[11px] text-muted sm:grid-cols-[repeat(7,minmax(0,1fr))_88px]">
          {weekdays.map((w) => (
            <div key={w} className="px-2 py-2">
              {w}
            </div>
          ))}
          <div className="px-2 py-2 text-right">{c.weekTotal}</div>
        </div>
        {weeks.map((week) => {
          const weekSec = week.flatMap((d) => byDay.get(d) ?? []).reduce((s, g) => s + seconds(g), 0);
          return (
            <div key={week[0]} className="grid grid-cols-[repeat(7,minmax(0,1fr))_64px] border-b border-line last:border-b-0 sm:grid-cols-[repeat(7,minmax(0,1fr))_88px]">
              {week.map((d) => {
                const list = byDay.get(d) ?? [];
                const outside = d.slice(0, 7) !== anchor.slice(0, 7);
                return (
                  <div key={d} className={`min-h-24 border-r border-line p-1.5 ${outside ? "bg-surface-2/60" : ""}`}>
                    <Link
                      href={href({ mode: "day", date: d })}
                      className={`tnum mb-1 inline-grid size-6 place-items-center rounded-full text-[11.5px] transition hover:bg-surface-3 ${
                        d === today ? "bg-accent font-semibold text-accent-ink hover:bg-accent" : outside ? "text-faint" : "text-muted"
                      }`}
                    >
                      {Number(d.slice(8))}
                    </Link>
                    <div className="space-y-1">
                      {list.slice(0, 3).map((g) => (
                        <WorkoutChip key={g.id} g={g} t={t} units={user.units} />
                      ))}
                      {list.length > 3 && (
                        <Link href={href({ mode: "day", date: d })} className="block px-1 text-[10.5px] text-muted hover:text-ink">
                          {fill(c.more, { n: list.length - 3 })}
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="tnum flex items-start justify-end p-2 text-[11.5px] font-medium">{weekSec > 0 ? hours(weekSec) : <span className="text-faint">—</span>}</div>
            </div>
          );
        })}
      </div>
    );
  } else if (mode === "week") {
    const days = daysBetween(from, to);
    body = (
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d, i) => {
          const list = byDay.get(d) ?? [];
          const daySec = list.reduce((s, g) => s + seconds(g), 0);
          return (
            <div key={d} className="min-w-0">
              <Link href={href({ mode: "day", date: d })} className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
                <span className="text-[12px] text-muted">{weekdays[i]}</span>
                <span className={`tnum text-[13px] font-semibold ${d === today ? "text-accent" : ""}`}>{Number(d.slice(8))}</span>
              </Link>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-[11px] text-faint">{c.restDay}</p>
                ) : (
                  list.map((g) => <WorkoutCard key={g.id} g={g} t={t} units={user.units} tz={user.timezone} locale={locale} />)
                )}
              </div>
              {daySec > 0 && <p className="tnum mt-2 px-0.5 text-right text-[11px] text-muted">{hours(daySec)}</p>}
            </div>
          );
        })}
      </div>
    );
  } else if (mode === "day") {
    const list = byDay.get(anchor) ?? [];
    const metrics = await db
      .select()
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, user.id), eq(dailyMetrics.day, anchor), inArray(dailyMetrics.metric, ["recovery_score", "readiness_score", "hrv_rmssd", "resting_hr", "sleep_duration", "strain"])));
    body = (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {list.length === 0 ? <Empty title={c.restDay} /> : list.map((g) => <WorkoutCard key={g.id} g={g} t={t} units={user.units} tz={user.timezone} locale={locale} />)}
        </div>
        <section className="self-start rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-[13px] font-semibold">{c.bodyThatDay}</h2>
          {metrics.length === 0 ? (
            <p className="text-sm text-faint">—</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {metrics.map((m) => (
                <div key={m.metric} className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{t.metrics[m.metric as keyof Dict["metrics"]]}</dt>
                  <dd className="tnum font-medium">{formatMetric(m.metric, m.value, user.units)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    );
  } else {
    // Year: a heat map per month, intensity by daily training time.
    const year = anchor.slice(0, 4);
    const level = (s: number) => (s === 0 ? 0 : s < 1800 ? 1 : s < 3600 ? 2 : s < 7200 ? 3 : 4);
    const shade = ["bg-surface-3", "bg-accent/25", "bg-accent/50", "bg-accent/75", "bg-accent"];
    body = (
      <div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, m) => {
            const first = `${year}-${String(m + 1).padStart(2, "0")}-01`;
            const cells = daysBetween(weekStart(first), addDays(weekStart(monthEnd(first)), 6));
            const monthSec = daysBetween(first, monthEnd(first)).reduce((s, d) => s + (byDay.get(d) ?? []).reduce((x, g) => x + seconds(g), 0), 0);
            return (
              <div key={first} className="rounded-xl border border-line bg-surface p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <Link href={href({ mode: "month", date: first })} className="text-[13px] font-medium hover:text-accent">
                    {new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", timeZone: "UTC" }).format(utc(first))}
                  </Link>
                  <span className="tnum text-[11px] text-muted">{monthSec ? hours(monthSec) : "—"}</span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((d) => {
                    const inMonth = d.slice(0, 7) === first.slice(0, 7);
                    const s = (byDay.get(d) ?? []).reduce((x, g) => x + seconds(g), 0);
                    return inMonth ? (
                      <Link
                        key={d}
                        href={href({ mode: "day", date: d })}
                        title={`${d}${s ? ` · ${hours(s)}` : ""}`}
                        className={`aspect-square rounded-[3px] ${shade[level(s)]} ${d === today ? "ring-1 ring-ink" : ""}`}
                      />
                    ) : (
                      <span key={d} className="aspect-square" />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-end gap-1.5 text-[11px] text-muted">
          {c.less}
          {shade.map((s) => (
            <span key={s} className={`size-3 rounded-[3px] ${s}`} />
          ))}
          {c.moreIntensity}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title={a.title} description={a.desc} />
      {header}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {canPrev ? (
            <Link href={href({ date: clampDay(prev) })} aria-label={c.prev} className={navBtn}>
              ‹
            </Link>
          ) : (
            <span className={`${navBtn} opacity-40`}>‹</span>
          )}
          {canNext ? (
            <Link href={href({ date: clampDay(next) })} aria-label={c.next} className={navBtn}>
              ›
            </Link>
          ) : (
            <span className={`${navBtn} opacity-40`}>›</span>
          )}
          <Link href={href({ date: today })} className="h-8 rounded-md border border-line bg-surface px-3 text-[12.5px] leading-8 text-muted transition hover:text-ink">
            {c.today}
          </Link>
          <h2 className="ml-2 text-lg font-semibold tracking-tight">{periodTitle(mode, anchor, locale)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateJump value={anchor} label={c.jump} />
          <Segmented items={MODES.map((m) => ({ href: href({ mode: m }), label: c[m], active: mode === m }))} />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <div className="bg-surface px-4 py-3">
          <p className="text-[11.5px] text-muted">{a.title}</p>
          <p className="tnum mt-1 text-xl font-semibold">{inFocus.length}</p>
        </div>
        <div className="bg-surface px-4 py-3">
          <p className="text-[11.5px] text-muted">{c.totalTime}</p>
          <p className="tnum mt-1 text-xl font-semibold">{totalSec ? hours(totalSec) : "—"}</p>
        </div>
        <div className="bg-surface px-4 py-3">
          <p className="text-[11.5px] text-muted">{c.totalDistance}</p>
          <p className="tnum mt-1 text-xl font-semibold">{totalM ? formatDistance(totalM, user.units) : "—"}</p>
        </div>
        <div className="bg-surface px-4 py-3">
          <p className="text-[11.5px] text-muted">{c.sportsMix}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[...bySport].length === 0 ? (
              <span className="text-xl font-semibold">—</span>
            ) : (
              [...bySport]
                .sort((x, y) => y[1] - x[1])
                .slice(0, 5)
                .map(([s, sec]) => (
                  <span key={s} title={`${t.sports[s as Sport]} · ${hours(sec)}`} className="flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]">
                    <SportIcon sport={s} size={13} />
                    <span className="tnum text-muted">{hours(sec)}</span>
                  </span>
                ))
            )}
          </div>
        </div>
      </div>

      {inFocus.length === 0 && mode !== "day" && <p className="mb-3 text-sm text-faint">{c.noWorkouts}</p>}
      {body}
    </>
  );
}
