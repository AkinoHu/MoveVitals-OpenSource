// Shared pieces for the Body Lab pages and the overview alerts card.

import Link from "next/link";
import { fill, type Dict } from "@/i18n";
import type { Alert } from "@/lib/lab/baseline";
import type { Range } from "@/lib/lab/markers";

export function rangeText(r: Range | null, fmt: (v: number) => string): string | null {
  if (!r || (r.low == null && r.high == null)) return null;
  if (r.low != null && r.high != null) return `${fmt(r.low)}–${fmt(r.high)}`;
  return r.low != null ? `≥ ${fmt(r.low)}` : `< ${fmt(r.high!)}`;
}

export function AlertList({ alerts, t, compact = false }: { alerts: Alert[]; t: Dict; compact?: boolean }) {
  const x = t.dash.lab;
  const name = (m: string) => t.metrics[m as keyof Dict["metrics"]] ?? m;
  return (
    <ul className="space-y-2">
      {alerts.slice(0, compact ? 3 : 8).map((a) => {
        const key = a.kind === "strain" ? `strain-${a.metrics.join()}` : a.metric;
        const warn = a.kind === "strain" || a.adverse;
        return (
          <li key={key} className={`rounded-lg border px-4 py-3 text-[13.5px] ${warn ? "border-warn/30 bg-warn-bg" : "border-line bg-surface-2"}`}>
            {a.kind === "strain" ? (
              <>
                <p className={`font-medium ${warn ? "text-warn" : ""}`}>{x.strainTitle}</p>
                {!compact && <p className="mt-1 text-muted">{fill(x.strainBody, { list: a.metrics.map(name).join(" · ") })}</p>}
                {compact && <p className="mt-1 text-muted">{a.metrics.map(name).join(" · ")}</p>}
              </>
            ) : (
              <p className={`font-medium ${warn ? "text-warn" : ""}`}>{fill(a.direction === "up" ? x.metricUp : x.metricDown, { m: name(a.metric) })}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LabAlertsCard({ alerts, t }: { alerts: Alert[]; t: Dict }) {
  if (!alerts.length) return null;
  return (
    <section className="mb-6 rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight">{t.dash.lab.signals}</h2>
        <Link href="/dashboard/lab" className="text-xs text-muted hover:text-ink">
          {t.dash.lab.viewLab}
        </Link>
      </div>
      <AlertList alerts={alerts} t={t} compact />
    </section>
  );
}
