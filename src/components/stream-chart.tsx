"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { elevationUnit, metersTo } from "@/lib/units";
import { useUnits } from "./units-context";

const SERIES: { key: "watts" | "heartrate" | "cadence" | "altitude"; label: "power" | "hr" | "cadence" | "altitude"; unit: string; color: string; width: number }[] = [
  { key: "watts", label: "power", unit: "W", color: "var(--accent)", width: 1.4 },
  { key: "heartrate", label: "hr", unit: "bpm", color: "var(--text)", width: 1.4 },
  { key: "cadence", label: "cadence", unit: "rpm", color: "var(--muted)", width: 1.1 },
  { key: "altitude", label: "altitude", unit: "m", color: "var(--faint)", width: 1.1 },
];

const H = 240;
const PAD = { t: 10, b: 24 };
const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

function downsample(xs: number[], ys: number[], target: number): [number, number][] {
  const step = Math.max(1, Math.floor(xs.length / target));
  const out: [number, number][] = [];
  for (let i = 0; i < xs.length; i += step) {
    const slice = ys.slice(i, i + step).filter((v) => v != null);
    if (slice.length) out.push([xs[i], slice.reduce((a, b) => a + b, 0) / slice.length]);
  }
  return out;
}

// Each series is drawn on its own vertical scale; the tooltip shows real values.
export function StreamChart({ streams: rawStreams }: { streams: Record<string, number[]> }) {
  const { t } = useI18n();
  const a = t.dash.activities;
  const units = useUnits();
  // Altitude follows the unit system; other streams are unit-neutral.
  const streams = useMemo(
    () => (units === "metric" || !rawStreams.altitude ? rawStreams : { ...rawStreams, altitude: rawStreams.altitude.map((v) => metersTo(units, v)) }),
    [rawStreams, units],
  );
  const unitOf = (s: (typeof SERIES)[number]) => (s.key === "altitude" ? elevationUnit(units) : s.unit);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const time = useMemo(() => streams.time ?? [], [streams]);
  const available = SERIES.filter((s) => streams[s.key]?.length);
  const [active, setActive] = useState(available.slice(0, 2).map((s) => s.key));
  const tMax = time[time.length - 1] || 1;

  const scaled = useMemo(
    () =>
      Object.fromEntries(
        available.map((s) => {
          const pts = downsample(time, streams[s.key], Math.max(200, width));
          const ys = pts.map((p) => p[1]);
          return [s.key, { pts, min: Math.min(...ys), max: Math.max(...ys) }];
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streams, time, width],
  );

  if (!time.length || !available.length) return <p className="text-sm text-muted">{a.noStreams}</p>;
  const x = (t: number) => (t / tMax) * width;
  const y = (v: number, min: number, max: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - min) / (max - min || 1));
  const idx = hover == null ? null : Math.min(time.length - 1, Math.max(0, time.findIndex((t) => t >= hover)));

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {available.map((s) => {
          const vals = streams[s.key].filter((v) => v > 0);
          const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
          const on = active.includes(s.key);
          return (
            <button
              key={s.key}
              onClick={() => setActive(on ? active.filter((k) => k !== s.key) : [...active, s.key])}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition ${on ? "border-line-strong bg-surface-2" : "border-line text-faint"}`}
            >
              <span className="h-0.5 w-3" style={{ background: s.color, opacity: on ? 1 : 0.35 }} />
              <span>{a[s.label]}</span>
              <span className="tnum font-medium text-ink">
                {avg} <span className="font-normal text-muted">{unitOf(s)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div ref={ref} className="relative" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            className="block touch-none"
            onPointerMove={(e) => setHover(((e.clientX - e.currentTarget.getBoundingClientRect().left) / width) * tMax)}
            onPointerLeave={() => setHover(null)}
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={0} x2={width} y1={PAD.t + (H - PAD.t - PAD.b) * f} y2={PAD.t + (H - PAD.t - PAD.b) * f} stroke="var(--border)" strokeDasharray="2 3" />
            ))}
            <line x1={0} x2={width} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--border)" />
            {available
              .filter((s) => active.includes(s.key))
              .map((s) => {
                const { pts, min, max } = scaled[s.key];
                const d = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v, min, max).toFixed(1)}`).join("");
                return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinejoin="round" />;
              })}
            {Array.from({ length: 5 }, (_, i) => (i / 4) * tMax).map((t, i) => (
              <text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} className="tnum fill-faint text-[10.5px]">
                {clock(t)}
              </text>
            ))}
            {idx != null && (
              <g>
                <line x1={x(time[idx])} x2={x(time[idx])} y1={PAD.t} y2={H - PAD.b} stroke="var(--text)" strokeOpacity={0.35} />
                {available
                  .filter((s) => active.includes(s.key))
                  .map((s) => {
                    const v = streams[s.key][idx];
                    const { min, max } = scaled[s.key];
                    return v == null ? null : <circle key={s.key} cx={x(time[idx])} cy={y(v, min, max)} r={3.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
                  })}
              </g>
            )}
          </svg>
        )}
        {idx != null && width > 0 && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-32 rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
            style={{ left: x(time[idx]) > width - 180 ? x(time[idx]) - 12 : x(time[idx]) + 12, transform: x(time[idx]) > width - 180 ? "translateX(-100%)" : undefined }}
          >
            <p className="tnum mb-1 font-medium">{clock(time[idx])}</p>
            {available
              .filter((s) => active.includes(s.key))
              .map((s) => (
                <p key={s.key} className="flex justify-between gap-4 text-muted">
                  <span>{a[s.label]}</span>
                  <span className="tnum font-medium text-ink">
                    {Math.round(streams[s.key][idx] ?? 0)} {unitOf(s)}
                  </span>
                </p>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
