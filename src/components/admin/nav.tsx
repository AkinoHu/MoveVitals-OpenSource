"use client";

import { IconArticle, IconDatabaseExport, IconDeviceWatchPlus, IconLayoutDashboard, IconPhoto, IconUserCheck, IconUsers, type Icon } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, Icon> = {
  "/admin": IconLayoutDashboard,
  "/admin/posts": IconArticle,
  "/admin/authors": IconUserCheck,
  "/admin/media": IconPhoto,
  "/admin/requests": IconDeviceWatchPlus,
  "/admin/users": IconUsers,
  "/admin/backups": IconDatabaseExport,
};

export function AdminNav({ items }: { items: [href: string, label: string][] }) {
  // Pages are served under /{locale}/admin internally but linked unprefixed.
  const path = usePathname().replace(/^\/(en|zh-CN|zh-TW|fr|es)(?=\/)/, "");
  return (
    <nav aria-label="Admin" className="-mx-3 flex gap-0.5 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:flex-col md:px-0 [&::-webkit-scrollbar]:hidden">
      {items.map(([href, label]) => {
        const active = href === "/admin" ? path === href : path.startsWith(href);
        const Ico = ICONS[href];
        return (
          <Link
            key={href}
            href={href}
            ref={active ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] transition ${
              active ? "bg-surface-3 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {active && <span className="absolute top-1.5 bottom-1.5 left-0 hidden w-0.5 rounded-full bg-accent md:block" />}
            {Ico && <Ico size={16} stroke={1.75} />}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
