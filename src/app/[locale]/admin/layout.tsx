import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/admin/nav";
import { LanguageSwitcher, ThemeToggle } from "@/components/preferences";
import { Logo } from "@/components/ui";
import { toLocale } from "@/i18n";
import { requireAdmin } from "@/lib/admin";
import { adminDict } from "./strings";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  const locale = toLocale((await params).locale);
  const a = adminDict(locale);
  const user = await requireAdmin();
  return (
    <div className="flex w-full flex-1 flex-col md:flex-row">
      <aside className="border-b border-line bg-surface px-3 py-3 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:px-3 md:py-5">
        <div className="mb-3 flex items-center gap-2 px-2 md:mb-7">
          <Logo href="/admin" height={16} />
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted uppercase">CMS</span>
          <Link href="/dashboard" className="ml-auto text-xs text-muted hover:text-ink md:hidden">
            {a.nav.app}
          </Link>
        </div>
        <AdminNav
          items={[
            ["/admin/requests", a.nav.requests],
            ["/admin/users", a.nav.users],
            ["/admin/backups", a.nav.backups],
          ]}
        />
        <div className="mt-auto hidden space-y-3 border-t border-line px-2 pt-4 text-[13px] md:block">
          <Link href="/dashboard" className="block text-muted hover:text-ink">
            {a.nav.app}
          </Link>
          <div className="flex items-center gap-2 pt-2">
            <LanguageSwitcher placement="up" />
            <ThemeToggle />
          </div>
          <p className="truncate text-xs text-faint">{user.email}</p>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-9">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
