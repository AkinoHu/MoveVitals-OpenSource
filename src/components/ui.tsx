import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { providerName } from "@/lib/providers/catalog";
import { BrandIcon } from "./brand/brand-icon";
import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from "./brand/wordmark-path";

export function Wordmark({ className = "h-4" }: { className?: string }) {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} className={`w-auto fill-current ${className}`} role="img" aria-label="MoveVitals">
      {WORDMARK_PATHS.map((d) => (
        <path key={d} d={d} fillRule="evenodd" />
      ))}
    </svg>
  );
}

// The "Move Vitals" wordmark: black artwork on light themes, white on dark.
export function Logo({ className = "", href = "/", height = 18 }: { className?: string; href?: string; height?: number }) {
  return (
    <Link href={href} className={`flex items-center ${className}`} aria-label="MoveVitals">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-wordmark-black.png" alt="MoveVitals" width={511} height={54} style={{ height }} className="w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-wordmark-white.png" alt="" aria-hidden width={473} height={54} style={{ height }} className="hidden w-auto dark:block" />
    </Link>
  );
}

export function Card({ children, className = "", title, action, flush = false }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; flush?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

const BUTTON = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
  inverse: "bg-ink text-bg hover:opacity-85",
  danger: "border border-line text-danger hover:bg-surface-2",
  ghost: "text-muted hover:text-ink",
};

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      {...props}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON[variant]} ${className}`}
    />
  );
}

export function ButtonLink({ href, variant = "primary", children, className = "", size = "md" }: { href: string; variant?: keyof typeof BUTTON; children: ReactNode; className?: string; size?: "md" | "lg" }) {
  const sizing = size === "lg" ? "h-11 px-5 text-[15px]" : "h-9 px-4 text-sm";
  return (
    <Link href={href} className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition ${sizing} ${BUTTON[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`h-9 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none transition focus:border-ink ${props.className ?? ""}`} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={`h-9 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-ink ${props.className ?? ""}`} />;
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-medium text-muted">
      {children}
      {hint && <span className="ml-1 font-normal text-faint">{hint}</span>}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const styles = {
    neutral: "border border-line text-muted",
    good: "bg-ink text-bg",
    warn: "bg-warn-bg text-warn",
    bad: "bg-danger/10 text-danger",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${styles}`}>{children}</span>;
}

// Small chip naming where a value came from. `origin` is the original
// recorder when the data was relayed (e.g. Zwift via Strava).
export function SourceBadge({ provider, origin }: { provider: string; origin?: string | null }) {
  return (
    <span
      className="group inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted"
      title={origin ? `${origin} → ${providerName(provider)}` : providerName(provider)}
    >
      <BrandIcon id={provider} size={12} />
      {providerName(provider)}
      {origin && <span className="text-faint">· {origin}</span>}
    </span>
  );
}

export function ConflictBadge({ label }: { label: string }) {
  return (
    <Badge tone="warn">
      <span className="size-1.5 rounded-full bg-warn" />
      {label}
    </Badge>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

// 1px-ruled strip of headline numbers.
export function StatStrip({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode; highlight?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
      {items.map((s) => (
        <div key={s.label} className="bg-surface px-4 py-3.5">
          <p className="text-[11.5px] text-muted">{s.label}</p>
          <p className={`tnum mt-1 text-[22px] font-semibold leading-none tracking-tight ${s.highlight ? "text-accent" : ""}`}>{s.value}</p>
          {s.sub && <p className="mt-1.5 text-[11px] text-faint">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}
