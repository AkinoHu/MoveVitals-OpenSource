import type { Metadata } from "next";
import { logout } from "@/app/actions";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { DashboardNav } from "@/components/dashboard-nav";
import { UnitsProvider } from "@/components/units-context";
import { LanguageSwitcher, ThemeToggle } from "@/components/preferences";
import { Button, Logo } from "@/components/ui";
import { getDict, toLocale } from "@/i18n";
import { isAdmin } from "@/lib/admin";
import { requireUser } from "@/lib/auth";

// The signed-in app is private: never index it.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children, params }: LayoutProps<"/[locale]/dashboard">) {
  const t = getDict(toLocale((await params).locale));
  const user = await requireUser();
  return (
    <div className="flex w-full flex-1 flex-col md:flex-row">
      <aside className="border-b border-line bg-surface px-3 py-3 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:px-3 md:py-5">
        <div className="mb-3 flex items-center justify-between px-2 md:mb-7">
          <Logo href="/dashboard" height={16} />
          {/* Phones: the sidebar footer is hidden, so account actions live here. */}
          <details className="group relative md:hidden">
            <summary className="flex cursor-pointer list-none items-center rounded-full [&::-webkit-details-marker]:hidden" aria-label={t.dash.myAccount}>
              <Avatar updatedAt={user.avatarUpdatedAt} size={28} />
            </summary>
            <div className="absolute top-full right-0 z-40 mt-2 w-64 space-y-3 rounded-xl border border-line bg-surface p-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{user.name ?? t.dash.myAccount}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LanguageSwitcher />
                <ThemeToggle />
              </div>
              <div className="flex items-center gap-4 border-t border-line pt-3 text-xs">
                {isAdmin(user) && (
                  <Link href="/admin" className="text-muted hover:text-ink">
                    CMS
                  </Link>
                )}
                <form action={logout}>
                  <Button variant="ghost" className="h-auto px-0 text-xs">
                    {t.common.logout}
                  </Button>
                </form>
              </div>
            </div>
          </details>
        </div>
        <DashboardNav />
        <div className="mt-auto hidden space-y-4 border-t border-line px-2 pt-4 md:block">
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher placement="up" />
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-2.5">
            <Link href="/dashboard/settings" aria-label={t.dash.nav.settings}>
              <Avatar updatedAt={user.avatarUpdatedAt} size={32} />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{user.name ?? t.dash.myAccount}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isAdmin(user) && (
              <Link href="/admin" className="mt-2 text-xs text-muted hover:text-ink">
                CMS
              </Link>
            )}
            <form action={logout}>
              <Button variant="ghost" className="mt-2 h-auto px-0 text-xs">
                {t.common.logout}
              </Button>
            </form>
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-9">
        <div className="mx-auto max-w-6xl">
          <UnitsProvider units={user.units}>{children}</UnitsProvider>
        </div>
      </main>
    </div>
  );
}
