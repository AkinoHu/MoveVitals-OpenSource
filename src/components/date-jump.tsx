"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CALENDAR_MAX, CALENDAR_MIN } from "@/lib/time";

// Jump the calendar to any day between 2010 and 2999.
export function DateJump({ value, label }: { value: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <input
      type="date"
      aria-label={label}
      title={label}
      min={CALENDAR_MIN}
      max={CALENDAR_MAX}
      defaultValue={value}
      key={value}
      onChange={(e) => {
        const v = e.target.value;
        if (!v || v < CALENDAR_MIN || v > CALENDAR_MAX) return;
        const next = new URLSearchParams(params);
        next.set("date", v);
        router.push(`${pathname}?${next}`);
      }}
      className="tnum h-8 rounded-md border border-line bg-surface px-2 text-[12.5px] text-muted outline-none focus:border-ink"
    />
  );
}
