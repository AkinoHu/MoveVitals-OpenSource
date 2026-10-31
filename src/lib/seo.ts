import type { Metadata } from "next";
import { DEFAULT_LOCALE, LOCALES, OG_LOCALE, type Locale } from "@/i18n/config";

export const SITE_URL = (process.env.APP_URL ?? "https://movevitals.com").replace(/\/$/, "");

// Absolute URL of a public page in a locale. `path` is locale-less ("/privacy").
export function localeUrl(locale: Locale, path = "/"): string {
  return `${SITE_URL}/${locale}${path === "/" ? "" : path}`;
}

// hreflang alternates for every locale plus x-default (English).
export function alternates(locale: Locale, path = "/"): Metadata["alternates"] {
  return {
    canonical: localeUrl(locale, path),
    languages: {
      ...Object.fromEntries(LOCALES.map((l) => [l, localeUrl(l, path)])),
      "x-default": localeUrl(DEFAULT_LOCALE, path),
    },
  };
}

export function pageMetadata({
  locale,
  path = "/",
  title,
  description,
  index = true,
}: {
  locale: Locale;
  path?: string;
  title: string;
  description: string;
  index?: boolean;
}): Metadata {
  const image = `${SITE_URL}/og/${locale}.png?v=3`;
  return {
    title,
    description,
    alternates: alternates(locale, path),
    robots: index ? { index: true, follow: true, "max-image-preview": "large" } : { index: false, follow: true },
    openGraph: {
      type: "website",
      siteName: "MoveVitals",
      url: localeUrl(locale, path),
      title,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images: [{ url: image, width: 1200, height: 630, alt: "MoveVitals" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

// <script type="application/ld+json"> payload, with "<" escaped so the
// JSON can never close the script tag.
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
