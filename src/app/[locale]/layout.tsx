import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/i18n/client";
import { LOCALES, isLocale } from "@/i18n/config";
import { getDict } from "@/i18n";
import { SITE_URL } from "@/lib/seo";
import { fontVariables } from "../fonts";
import "../globals.css";


export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = getDict(isLocale(locale) ? locale : "en");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t.meta.title, template: `%s · MoveVitals` },
    description: t.meta.description,
    applicationName: "MoveVitals",
    keywords: t.meta.keywords,
    authors: [{ name: "MoveVitals" }],
    creator: "MoveVitals",
    verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined },
    formatDetection: { telephone: false, email: false, address: false },
    appleWebApp: { title: "MoveVitals", statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Explicit theme choice comes from a cookie so the server renders it (no
  // flash, survives client navigation); "system" follows the OS via CSS.
  const theme = (await cookies()).get("mv_theme")?.value;
  return (
    <html lang={locale} className={`${fontVariables} h-full antialiased`}
      style={{ ["--font-cjk" as string]: locale === "zh-TW" ? "var(--font-noto-tc), var(--font-noto-sc)" : "var(--font-noto-sc), var(--font-noto-tc)" }} data-theme={theme === "dark" || theme === "light" ? theme : undefined}>
      <body className="flex min-h-full flex-col">
        <I18nProvider locale={locale} dict={getDict(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
