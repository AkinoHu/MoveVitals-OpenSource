import { and, eq, gte } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LineChart } from "@/components/charts";
import { rangeText } from "@/components/lab";
import { DeleteResultButton } from "@/components/lab-forms";
import { PageHeader } from "@/components/page-header";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { fill, getDict, toLocale, type Dict } from "@/i18n";
import { INTL_LOCALE } from "@/i18n/config";
import { getLabCopy } from "@/i18n/lab";
import { requireUser } from "@/lib/auth";
import { postByKey } from "@/lib/content";
import { db } from "@/lib/db";
import { dailyMetrics } from "@/lib/db/schema";
import { labResultsOf, printedRange, userSex } from "@/lib/lab/data";
import { MARKER_MAP, flagOf, formatMarker, refFor } from "@/lib/lab/markers";
import { addDays, dayInTz } from "@/lib/time";

export default async function LabMarkerPage({ params }: PageProps<"/[locale]/dashboard/lab/[marker]">) {
  const { locale: raw, marker } = await params;
  const def = MARKER_MAP[marker];
  if (!def) notFound();
  const locale = toLocale(raw);
  const t = getDict(locale);
  const x = t.dash.lab;
  const info = getLabCopy(locale).items[marker as keyof ReturnType<typeof getLabCopy>["items"]] as { name: string; what: string; how: string; learn: string };
  const user = await requireUser();
  const today = dayInTz(new Date(), user.timezone);
  const [rows, sex, guide, device] = await Promise.all([
    labResultsOf(user.id, marker),
    userSex(user.id),
    def.guide ? postByKey(locale, def.guide) : null,
    def.metric
      ? db
          .select({ day: dailyMetrics.day, value: dailyMetrics.value })
          .from(dailyMetrics)
          .where(and(eq(dailyMetrics.userId, user.id), eq(dailyMetrics.metric, def.metric), gte(dailyMetrics.day, addDays(today, -89))))
      : [],
  ]);
  const last = rows.at(-1);
  const ref = refFor(marker, sex, last ? printedRange(last) : null);
  const fmt = (v: number) => formatMarker(marker, v);
  const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(INTL_LOCALE[locale], { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const days90 = Array.from({ length: 90 }, (_, i) => addDays(today, i - 89));
  const byDay = new Map(device.map((d) => [d.day, d.value]));
  const rt = rangeText(ref, fmt);

  return (
    <>
      <PageHeader
        title={info.name}
        description={rt ? fill(x.typical, { range: `${rt} ${def.unit}` }) : undefined}
        action={<ButtonLink href={`/dashboard/lab/add?marker=${marker}`}>{x.addResult}</ButtonLink>}
      />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card title={x.history}>
          {rows.length === 0 ? (
            <p className="py-6 text-[13px] text-muted">{x.noHistory}</p>
          ) : (
            <>
              {rows.length > 1 && (
                <LineChart
                  days={rows.map((r) => r.takenOn)}
                  unit={def.unit}
                  height={200}
                  band={ref?.low != null && ref?.high != null ? { lo: ref.low, hi: ref.high } : null}
                  baselineLabel={x.inRange}
                  series={[{ key: "v", label: info.name, values: rows.map((r) => r.value), tone: "accent", dots: true }]}
                />
              )}
              <ul className="mt-4 divide-y divide-line text-[13.5px]">
                {[...rows].reverse().map((r) => {
                  const flag = flagOf(r.value, refFor(marker, sex, printedRange(r)));
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <span>
                        <span className="tnum font-semibold">
                          {fmt(r.value)} {def.unit}
                        </span>
                        <span className="ml-2 text-xs text-muted">
                          {date(r.takenOn)} · {r.source === "manual" ? x.manual : x.fromReport}
                          {r.note ? ` · ${r.note}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        {flag && <Badge tone={flag === "in" ? "neutral" : "warn"}>{flag === "in" ? x.inRange : flag === "high" ? x.high : x.low}</Badge>}
                        {r.reportId && (
                          <Link href={`/dashboard/lab/reports/${r.reportId}`} className="text-xs text-muted hover:text-ink">
                            {x.openFile}
                          </Link>
                        )}
                        <DeleteResultButton id={r.id} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <div className="space-y-2 text-[13px] leading-relaxed">
              <p>
                <span className="font-medium">{x.whatItIs}: </span>
                <span className="text-muted">{info.what}</span>
              </p>
              <p>
                <span className="font-medium">{x.howGet}: </span>
                <span className="text-muted">{info.how}</span>
              </p>
              <p>
                <span className="font-medium">{x.whatYouLearn}: </span>
                <span className="text-muted">{info.learn}</span>
              </p>
              {guide && (
                <Link href={`/${locale}/guides/${guide.slug}`} className="inline-block pt-1 text-[12.5px] font-medium hover:underline">
                  {x.readGuide}
                </Link>
              )}
            </div>
          </Card>
          {def.metric && device.length > 0 && (
            <Card title={fill(x.deviceTrend, { m: t.metrics[def.metric as keyof Dict["metrics"]] })}>
              <LineChart days={days90} metric={def.metric} height={160} series={[{ key: "d", label: def.metric, values: days90.map((d) => byDay.get(d) ?? null), tone: "ink" }]} />
            </Card>
          )}
        </div>
      </div>
      <p className="mt-6 text-[12px] leading-relaxed text-faint">{x.disclaimer}</p>
    </>
  );
}
