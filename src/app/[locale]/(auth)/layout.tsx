import { LanguageSwitcher, ThemeToggle } from "@/components/preferences";
import { Logo } from "@/components/ui";

export default async function AuthLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  return (
    <main id="main" className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-16">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(50%_50%_at_50%_40%,black,transparent)]" />
      <div className="relative w-full max-w-sm">
        <Logo href={`/${locale}`} className="mb-8 justify-center" height={20} />
        <div className="rounded-xl border border-line bg-surface p-7 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.25)]">{children}</div>
        <div className="mt-6 flex items-center justify-center gap-2">
          <LanguageSwitcher placement="up" />
          <ThemeToggle />
        </div>
      </div>
    </main>
  );
}
