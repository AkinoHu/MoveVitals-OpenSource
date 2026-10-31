"use client";

import { useI18n } from "@/i18n/client";

// Shown instantly on navigation while the server loads the page's data.
export default function Loading() {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite">
      <p className="sr-only">{t.common.loading}</p>
      <div aria-hidden className="space-y-5 animate-pulse motion-reduce:animate-none">
        <div className="h-7 w-48 rounded bg-surface-2" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
        <div className="h-72 rounded-xl border border-line bg-surface-2" />
      </div>
    </div>
  );
}
