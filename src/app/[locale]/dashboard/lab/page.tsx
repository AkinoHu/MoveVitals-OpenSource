import Link from "next/link";
import { AlertList, rangeText } from "@/components/lab";
import { PageHeader } from "@/components/page-header";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { fill, getDict, toLocale, type Dict } from "@/i18n";
import { INTL_LOCALE } from "@/i18n/config";
import { getLabCopy } from "@/i18n/lab";
import { requireUser } from "@/lib/auth";
import { listPublished } from "@/lib/content";
import { alertsFrom, baselinesFor } from "@/lib/lab/baseline";
import { calibrations, labResultsOf, latestByMarker, latestMetrics, printedRange, reportsOf, userSex } from "@/lib/lab/data";
import { DOMAINS, MARKER_MAP, METRIC_GUIDES, flagOf, formatMarker, itemCode, refFor, type DomainItem } from "@/lib/lab/markers";
import { formatMetric } from "@/lib/metrics";
import { providerName } from "@/lib/providers/catalog";
import { addDays } from "@/lib/time";

export default async function LabPage({ params }: PageProps<"/[locale]/dashboard/lab">) {
  const locale = toLocale((await params).locale);
  const t = getDict(locale);
  const x = t.dash.lab;
  const copy = getLabCopy(locale);
  const user = await requireUser();

  const [results, metrics, reports, sex, base, guides] = await Promise.all([
    labResultsOf(user.id),
    latestMetrics(user.id),
    reportsOf(user.id),
    userSex(user.id),
    baselinesFor(user.id, user.timezone),
    listPublished(locale),
  ]);
  const latest = latestByMarker(results);
  const calib = await calibrations(user.id, latest);
  const alerts = alertsFrom(base.baselines);
  const guideSlug = new Map(guides.map((g) => [g.translationKey, g.slug]));
  const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(INTL_LOCALE[locale], { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const metricName = (m: string) => t.metrics[m as keyof Dict["metrics"]] ?? m;

  const items = DOMAINS.flatMap((d) => d.items);
  const measured = items.filter((i) => ("marker" in i ? latest.has(i.marker) : metrics.has(i.metric))).length;

  function Item({ item }: { item: DomainItem }) {
    const code = itemCode(item);
    const info = copy.items[code as keyof typeof copy.items] as { name?: string; what: string; how: string; learn: string } | undefined;
    const guideKey = "marker" in item ? MARKER_MAP[code]?.guide : METRIC_GUIDES[code];
    const slug = guideKey ? guideSlug.get(guideKey) : undefined;
    let name: string;
    let value: string | null = null;
    let sub: string | null = null;
    const badges: { label: string; tone: "neutral" | "warn" }[] = [];

    if ("marker" in item) {
      const def = MARKER_MAP[code];
      name = info?.name ?? code;
      const r = latest.get(code);
      const ref = refFor(code, sex, r ? printedRange(r) : null);
      if (r) {
        value = `${formatMarker(code, r.value)} ${def.unit}`;
        sub = [date(r.takenOn), r.source === "manual" ? x.manual : x.fromReport].join(" · ");
        const flag = flagOf(r.value, ref);
        if (flag) badges.push({ label: flag === "in" ? x.inRange : flag === "high" ? x.high : x.low, tone: flag === "in" ? "neutral" : "warn" });
        if (r.takenOn < addDays(base.today, -Math.round(def.every * 30.4))) badges.push({ label: x.retest, tone: "neutral" });
      }
      const rt = rangeText(ref, (v) => formatMarker(code, v));
      if (rt) sub = [sub, fill(x.typical, { range: `${rt} ${def.unit}` })].filter(Boolean).join(" · ");
    } else {
      name = metricName(code);
      const m = metrics.get(code);
      const b = base.baselines[code];
      const fmt = (v: number) => formatMetric(code, v, user.units);
      if (m) {
        value = fmt(m.value);
        sub = [date(m.day), providerName(m.provider)].join(" · ");
        if (b) {
          sub = [sub, fill(x.yourNormal, { lo: fmt(b.low), hi: fmt(b.high) })].join(" · ");
          if (b.direction) badges.push({ label: b.direction === "up" ? x.aboveNormal : x.belowNormal, tone: b.adverse ? "warn" : "neutral" });
        } else sub = [sub, x.building].join(" · ");
        const ref = refFor(code, sex);
        const flag = flagOf(m.value, ref);
        if (flag && flag !== "in") badges.push({ label: flag === "high" ? x.high : x.low, tone: "warn" });
      }
    }

    return (
      <li>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-5 py-3 transition hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium">{name}</span>
              {sub && <span className="tnum mt-0.5 block text-[11.5px] text-muted">{sub}</span>}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {value ? <span className="tnum text-[14px] font-semibold">{value}</span> : <span className="text-[12px] text-faint">{x.missing}</span>}
              {badges.length > 0 && (
                <span className="flex flex-wrap justify-end gap-1">
                  {badges.map((b) => (
                    <Badge key={b.label} tone={b.tone}>
                      {b.label}
                    </Badge>
                  ))}
                </span>
              )}
            </span>
          </summary>
          {info && (
            <div className="space-y-2 border-t border-line bg-surface-2 px-5 py-4 text-[13px] leading-relaxed">
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
              <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[12.5px] font-medium">
                {"marker" in item ? (
                  <Link href={`/dashboard/lab/${code}`} className="hover:underline">
                    {latest.has(code) ? x.history : x.addResult} →
                  </Link>
                ) : (
                  <Link href={`/dashboard/data?metric=${code}`} className="hover:underline">
                    {t.common.details} →
                  </Link>
                )}
                {slug && (
                  <Link href={`/${locale}/guides/${slug}`} className="text-muted hover:text-ink hover:underline">
                    {x.readGuide}
                  </Link>
                )}
              </p>
            </div>
          )}
        </details>
      </li>
    );
  }

  return (
    <>
      <PageHeader
        title={x.title}
        description={x.desc}
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/dashboard/lab/upload" variant="secondary">
              {x.upload}
            </ButtonLink>
            <ButtonLink href="/dashboard/lab/add">{x.addResult}</ButtonLink>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-xl border border-line bg-surface p-5">
          <p className="tnum text-3xl font-semibold tracking-tight">{fill(x.coverage, { n: measured, total: items.length })}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(measured / items.length) * 100}%` }} />
          </div>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {DOMAINS.map((d) => {
              const have = d.items.filter((i) => ("marker" in i ? latest.has(i.marker) : metrics.has(i.metric))).length;
              return (
                <li key={d.code}>
                  <a href={`#${d.code}`} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition hover:border-line-strong ${have ? "border-line text-ink" : "border-dashed border-line text-faint"}`}>
                    {copy.domains[d.code as keyof typeof copy.domains].name}
                    <span className="tnum text-muted">
                      {have}/{d.items.length}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="mb-3 text-[13px] font-semibold tracking-tight">{x.signals}</h2>
          {alerts.length ? <AlertList alerts={alerts} t={t} /> : <p className="text-[13px] text-muted">{x.noSignals}</p>}
        </section>
      </div>

      {calib.length > 0 && (
        <Card title={x.calibTitle} className="mb-6">
          <p className="mb-3 text-[13px] text-muted">{x.calibBody}</p>
          <ul className="space-y-1.5 text-[13.5px]">
            {calib.map((c) => {
              const def = MARKER_MAP[c.marker];
              const diff = c.device - c.lab;
              const name = (copy.items[c.marker as keyof typeof copy.items] as { name?: string }).name ?? c.marker;
              return (
                <li key={c.marker} className="tnum">
                  <span className="font-medium">{name}</span>
                  <span className="text-muted">
                    {" · "}
                    {fill(x.calibRow, {
                      lab: `${formatMarker(c.marker, c.lab)} ${def.unit}`,
                      device: `${formatMarker(c.marker, c.device)} ${def.unit}${c.metric === "gmi" ? ` (${x.gmi})` : ""}`,
                      p: providerName(c.provider),
                      diff: `${diff >= 0 ? "+" : "−"}${formatMarker(c.marker, Math.abs(diff))} ${def.unit}`,
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="gap-6 lg:columns-2">
        {DOMAINS.map((d) => {
          const dc = copy.domains[d.code as keyof typeof copy.domains];
          return (
            <section key={d.code} id={d.code} className="mb-6 break-inside-avoid scroll-mt-6 overflow-hidden rounded-xl border border-line bg-surface">
              <header className="border-b border-line px-5 py-3.5">
                <h2 className="text-[14px] font-semibold tracking-tight">{dc.name}</h2>
                <p className="mt-0.5 text-[12px] text-muted">{dc.desc}</p>
              </header>
              <ul className="divide-y divide-line">
                {d.items.map((i) => (
                  <Item key={itemCode(i)} item={i} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <Card title={x.reports} flush>
        {reports.length === 0 ? (
          <p className="p-5 text-[13px] text-muted">{x.noReports}</p>
        ) : (
          <ul className="divide-y divide-line">
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/dashboard/lab/reports/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm transition hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="font-medium">{r.title}</span>
                    <span className="ml-2 text-xs text-muted">
                      {x.kinds[r.kind as keyof typeof x.kinds]} · {r.takenOn ? date(r.takenOn) : r.createdAt.toISOString().slice(0, 10)}
                    </span>
                  </span>
                  <Badge tone={r.status === "extracted" || r.status === "failed" ? "warn" : "neutral"}>{x.status[r.status as keyof typeof x.status] ?? r.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-6 text-[12px] leading-relaxed text-faint">{x.disclaimer}</p>
    </>
  );
}
