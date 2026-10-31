"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { formatMetric, toDisplay } from "@/lib/metrics";
import type { UnitSystem } from "@/lib/units";
import { useUnits } from "./units-context";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export type Tone = "ink" | "accent" | "muted" | "faint";
const STROKE: Record<Tone, string> = { ink: "var(--text)", accent: "var(--accent)", muted: "var(--muted)", faint: "var(--faint)" };

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function fmt(metric: string | undefined, v: number | null | undefined, unit?: string, units: UnitSystem = "metric"): string {
  if (v == null || Number.isNaN(v)) return "—";
  // Chart values are already converted to display units (see LineChart).
  if (metric) return formatMetric(metric, v, units, true);
  const n = Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1);
  return unit ? `${n} ${unit}` : n;
}

const shortDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function linePath(points: ([number, number] | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = x > width - 200 ? x - 12 : x + 12;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
      style={{ left, top: Math.max(0, y - 10), transform: x > width - 200 ? "translateX(-100%)" : undefined }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time-series line chart with crosshair, baseline band and draw-in
// ---------------------------------------------------------------------------

export type Series = { key: string; label: string; values: (number | null)[]; tone?: Tone; dashed?: boolean; dots?: boolean };

const LINE_PAD = { l: 44, r: 12, t: 12, b: 26 };
const COMPACT_PAD = { l: 2, r: 2, t: 6, b: 4 };

export function LineChart({
  days,
  series: rawSeries,
  metric,
  unit,
  height = 220,
  band: rawBand,
  baselineLabel = "Baseline",
  compact = false,
}: {
  days: string[];
  series: Series[];
  metric?: string;
  unit?: string;
  height?: number;
  // Shaded normal range, e.g. 30-day mean ± 1 SD.
  band?: { lo: number; hi: number } | null;
  baselineLabel?: string;
  compact?: boolean;
}) {
  // Values arrive in stored (metric) units; show them in the user's system.
  const units = useUnits();
  const { series, band } = useMemo(() => {
    if (units === "metric" || !metric) return { series: rawSeries, band: rawBand };
    const conv = (v: number | null) => (v == null ? v : toDisplay(metric, v, units));
    return {
      series: rawSeries.map((s) => ({ ...s, values: s.values.map(conv) })),
      band: rawBand ? { lo: conv(rawBand.lo)!, hi: conv(rawBand.hi)! } : rawBand,
    };
  }, [rawSeries, rawBand, metric, units]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const basePad = compact ? COMPACT_PAD : LINE_PAD;

  const { y, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
    if (band) all.push(band.lo, band.hi);
    let min = all.length ? Math.min(...all) : 0;
    let max = all.length ? Math.max(...all) : 1;
    const padY = (max - min || Math.abs(max) || 1) * 0.12;
    min -= padY;
    max += padY;
    const t = niceTicks(min, max, compact ? 2 : 4);
    if (!compact && t.length) {
      min = Math.min(min, t[0]);
      max = Math.max(max, t[t.length - 1]);
    }
    const inner = height - basePad.t - basePad.b;
    return { y: (v: number) => basePad.t + inner - ((v - min) / (max - min || 1)) * inner, ticks: t };
  }, [series, band, height, compact, basePad]);
  const tickLabel = (t: number) => fmt(metric, t, unit, units).replace(/ [^\d]+$/, "");
  // Widen the left gutter for long labels such as "7h 47m".
  const pad = compact ? basePad : { ...basePad, l: Math.max(basePad.l, 14 + 6.2 * Math.max(0, ...ticks.map((t) => tickLabel(t).length))) };

  const innerW = Math.max(width - pad.l - pad.r, 1);
  const x = (i: number) => pad.l + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(innerW / 64))));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - pad.l) / innerW) * (days.length - 1));
    setHover(Math.min(days.length - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block touch-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join("、")}>
          {!compact &&
            ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === ticks[0] ? undefined : "2 3"} />
                <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-faint text-[10.5px]">
                  {tickLabel(t)}
                </text>
              </g>
            ))}
          {band && (
            <rect x={pad.l} width={innerW} y={y(band.hi)} height={Math.max(0, y(band.lo) - y(band.hi))} fill="var(--text)" opacity={0.045}>
              <title>{baselineLabel}</title>
            </rect>
          )}
          {series.map((s, si) => {
            const pts = s.values.map((v, i) => (v == null ? null : ([x(i), y(v)] as [number, number])));
            const d = linePath(pts);
            return (
              <g key={s.key}>
                <path
                  d={d}
                  pathLength={s.dashed ? undefined : 1}
                  fill="none"
                  stroke={STROKE[s.tone ?? "ink"]}
                  strokeWidth={compact ? 1.5 : s.tone === "accent" ? 2 : 1.6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? "3 4" : undefined}
                  className={s.dashed ? "" : "chart-draw"}
                  style={{ ["--len" as string]: 1, animationDelay: `${si * 180}ms` }}
                />
                {s.dots &&
                  pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={2.2} fill="var(--surface)" stroke={STROKE[s.tone ?? "ink"]} strokeWidth={1.4} />)}
              </g>
            );
          })}
          {!compact &&
            days.map((d, i) =>
              i % labelEvery === 0 || i === days.length - 1 ? (
                <text key={d} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="tnum fill-faint text-[10.5px]">
                  {shortDay(d)}
                </text>
              ) : null,
            )}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--text)" strokeOpacity={0.35} />
              {series.map((s) => {
                const v = s.values[hover];
                return v == null ? null : <circle key={s.key} cx={x(hover)} cy={y(v)} r={3.5} fill={STROKE[s.tone ?? "ink"]} stroke="var(--surface)" strokeWidth={2} />;
              })}
            </g>
          )}
        </svg>
      )}
      {hover != null && width > 0 && (
        <Tooltip x={x(hover)} y={pad.t} width={width}>
          <p className="mb-1 font-medium">{days[hover]}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-4 text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3" style={{ background: STROKE[s.tone ?? "ink"] }} />
                {s.label}
              </span>
              <span className="tnum font-medium text-ink">{fmt(metric, s.values[hover], unit, units)}</span>
            </p>
          ))}
          {band && (
            <p className="mt-1 border-t border-line pt-1 text-[11px] text-faint">
              {baselineLabel} {fmt(metric, band.lo, unit, units)} – {fmt(metric, band.hi, unit, units)}
            </p>
          )}
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked daily bars (e.g. sleep stages)
// ---------------------------------------------------------------------------

export type Stack = { key: string; label: string; values: (number | null)[]; tone: "ink" | "ink-2" | "ink-3" | "accent" };
const FILL: Record<Stack["tone"], string> = { ink: "var(--text)", "ink-2": "var(--muted)", "ink-3": "var(--border-strong)", accent: "var(--accent)" };

export function StackedBars({ days, stacks, metric, unit, height = 200 }: { days: string[]; stacks: Stack[]; metric?: string; unit?: string; height?: number }) {
  const { t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const totals = days.map((_, i) => stacks.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const ticks = niceTicks(0, max * 1.05, 3);
  const top = Math.max(max * 1.05, ticks[ticks.length - 1] ?? 0);
  const inner = height - pad.t - pad.b;
  const y = (v: number) => pad.t + inner - (v / top) * inner;
  const innerW = Math.max(width - pad.l - pad.r, 1);
  const slot = innerW / Math.max(days.length, 1);
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(innerW / 64))));

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block" onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "2 3"} />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-faint text-[10.5px]">
                {fmt(metric, t, unit)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            let acc = 0;
            const cx = pad.l + slot * i + slot / 2;
            return (
              <g key={d} onPointerEnter={() => setHover(i)} opacity={hover == null || hover === i ? 1 : 0.45}>
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={inner} fill="transparent" />
                {stacks.map((s) => {
                  const v = s.values[i] ?? 0;
                  if (!v) return null;
                  const y0 = y(acc + v);
                  const h = y(acc) - y0;
                  acc += v;
                  return <rect key={s.key} x={cx - bw / 2} y={y0} width={bw} height={Math.max(0, h - 1)} fill={FILL[s.tone]} rx={1} />;
                })}
                {(i % labelEvery === 0 || i === days.length - 1) && (
                  <text x={cx} y={height - 8} textAnchor="middle" className="tnum fill-faint text-[10.5px]">
                    {shortDay(d)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && width > 0 && (
        <Tooltip x={pad.l + slot * hover + slot / 2} y={pad.t} width={width}>
          <p className="mb-1 font-medium">{days[hover]}</p>
          {[...stacks].reverse().map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-4 text-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: FILL[s.tone] }} />
                {s.label}
              </span>
              <span className="tnum font-medium text-ink">{fmt(metric, s.values[hover], unit)}</span>
            </p>
          ))}
          <p className="mt-1 flex justify-between border-t border-line pt-1 text-[11px] text-faint">
            <span>{t.common.total}</span>
            <span className="tnum">{fmt(metric, totals[hover], unit)}</span>
          </p>
        </Tooltip>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; tone: Tone | Stack["tone"]; dashed?: boolean; swatch?: "line" | "box" }[] }) {
  const color = (t: string) => (t in FILL ? FILL[t as Stack["tone"]] : STROKE[t as Tone]);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.swatch === "box" ? (
            <span className="size-2 rounded-sm" style={{ background: color(i.tone) }} />
          ) : (
            <span className="h-0 w-3.5 border-t-2" style={{ borderColor: color(i.tone), borderStyle: i.dashed ? "dashed" : "solid" }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}
