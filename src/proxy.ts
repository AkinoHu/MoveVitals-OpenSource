import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, isLocale, matchLocale } from "./i18n/config";

// Public pages live at /{locale}/… (canonical, indexable URLs). Unprefixed
// public URLs redirect to the visitor's language; the signed-in app keeps
// its unprefixed /dashboard (and /admin) URLs and is rewritten internally.
// Common language-tag spellings that should land on the matching locale
// instead of 404ing (/zh, /zh-Hans, /zh-cn, /zh-Hant, /zh-HK …).
const LOCALE_ALIASES: Record<string, string> = {
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
};

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split("/")[1];

  const alias = LOCALE_ALIASES[first.toLowerCase()];
  if (alias && !isLocale(first)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${alias}${pathname.slice(first.length + 1)}`;
    return NextResponse.redirect(url, 308);
  }

  if (isLocale(first)) {
    const res = NextResponse.next();
    if (req.cookies.get(LOCALE_COOKIE)?.value !== first) res.cookies.set(LOCALE_COOKIE, first, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  }

  const cookie = req.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie) ? cookie : matchLocale(req.headers.get("accept-language"));
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

  if (/^\/(dashboard|admin)(\/|$)/.test(pathname)) return NextResponse.rewrite(url);
  const res = NextResponse.redirect(url, 307);
  res.headers.set("Vary", "Accept-Language, Cookie");
  return res;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
