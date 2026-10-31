"use client";

import { useState, useTransition } from "react";
import { savePriority } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import { Button, SourceBadge } from "./ui";

export function PriorityEditor({ scope, label, order, custom }: { scope: string; label: string; order: string[]; custom: boolean }) {
  const { t } = useI18n();
  const d = t.dash.data;
  const [items, setItems] = useState(order);
  const [pending, start] = useTransition();
  const dirty = items.join() !== order.join();

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const submit = (providers: string[]) =>
    start(async () => {
      const fd = new FormData();
      fd.set("scope", scope);
      fd.set("providers", providers.join(","));
      await savePriority(fd);
    });

  return (
    <div className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 sm:flex-row sm:items-center">
      <div className="w-32 shrink-0 text-sm">
        {label}
        {custom && <span className="ml-1 text-[11px] text-accent">{d.custom}</span>}
      </div>
      <ol className="flex flex-1 flex-wrap items-center gap-1">
        {items.map((p, i) => (
          <li key={p} className="flex items-center">
            <span className="mr-0.5 text-[10px] text-muted">{i + 1}</span>
            <SourceBadge provider={p} />
            <span className="ml-0.5 flex flex-col leading-none">
              <button type="button" aria-label={d.moveUp} className="px-0.5 text-[9px] text-muted hover:text-ink disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)}>
                ▲
              </button>
              <button
                type="button"
                aria-label={d.moveDown}
                className="px-0.5 text-[9px] text-muted hover:text-ink disabled:opacity-20"
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                ▼
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex gap-1">
        {dirty && (
          <Button disabled={pending} onClick={() => submit(items)} className="text-xs">
            {pending ? d.recalculating : t.common.save}
          </Button>
        )}
        {custom && !dirty && (
          <Button variant="ghost" disabled={pending} onClick={() => submit([])} className="text-xs">
            {d.reset}
          </Button>
        )}
      </div>
    </div>
  );
}
