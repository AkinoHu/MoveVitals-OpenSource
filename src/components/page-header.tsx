import type { ReactNode } from "react";

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13.5px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
