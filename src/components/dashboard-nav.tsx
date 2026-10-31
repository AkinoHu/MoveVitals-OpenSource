"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";

export function DashboardNav() {
  const path = usePathname();
  const { t } = useI18n();
  const items = [
    ["/dashboard", t.dash.nav.overview],
    ["/dashboard/activities", t.dash.nav.activities],
    ["/dashboard/data", t.dash.nav.data],
    ["/dashboard/lab", t.dash.nav.lab],
    ["/dashboard/ai", t.dash.nav.ai],
    ["/dashboard/connections", t.dash.nav.connections],
    ["/dashboard/settings", t.dash.nav.settings],
  ] as const;
  return (
    <nav aria-label="Dashboard" className="-mx-3 flex gap-0.5 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:flex-col md:px-0 [&::-webkit-scrollbar]:hidden">
      {items.map(([href, label]) => {
        const active = href === "/dashboard" ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            ref={active ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
            aria-current={active ? "page" : undefined}
            className={`relative whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] transition ${
              active ? "bg-surface-3 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {active && <span className="absolute top-1.5 bottom-1.5 left-0 hidden w-0.5 rounded-full bg-accent md:block" />}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
