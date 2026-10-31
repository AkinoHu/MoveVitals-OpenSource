// Date helpers. Health data is bucketed by the user's local calendar day, so
// we always keep the UTC instant and derive the day with the right offset.

const pad = (n: number) => String(n).padStart(2, "0");

// "+08:00" | "-0530" | "Z" -> minutes
export function parseOffset(offset: string | null | undefined): number | null {
  if (!offset) return null;
  if (offset === "Z") return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -mins : mins;
}

export function dayWithOffset(instant: Date, offsetMinutes: number): string {
  const d = new Date(instant.getTime() + offsetMinutes * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function dayInTz(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ISO-8601 duration ("PT1H2M3.5S") -> seconds
export function isoDurationSeconds(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(s);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Offset (minutes) of `timeZone` at `instant`, e.g. Asia/Shanghai → 480.
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

// "2026-10-01 07:00:00" wall-clock time in `timeZone` → UTC instant.
export function zonedToUtc(local: string, timeZone: string): Date {
  const naive = new Date(`${local.replace(" ", "T")}Z`);
  const offset = tzOffsetMinutes(naive, timeZone);
  return new Date(naive.getTime() - offset * 60_000);
}

// ---- Calendar helpers (days are "YYYY-MM-DD" strings) ----------------------

export const CALENDAR_MIN = "2010-01-01";
export const CALENDAR_MAX = "2999-12-31";

export function clampDay(day: string): string {
  return day < CALENDAR_MIN ? CALENDAR_MIN : day > CALENDAR_MAX ? CALENDAR_MAX : day;
}

export function isDay(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

// ISO weeks start on Monday.
export function weekStart(day: string): string {
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: string, n: number): string {
  const d = new Date(`${monthStart(day)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function monthEnd(day: string): string {
  return addDays(addMonths(day, 1), -1);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
