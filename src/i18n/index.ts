import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import en, { type Dict } from "./dict/en";
import es from "./dict/es";
import fr from "./dict/fr";
import zhCN from "./dict/zh-CN";
import zhTW from "./dict/zh-TW";

export type { Dict };
export { fill } from "./fill";

const DICTS: Record<Locale, Dict> = { en, "zh-CN": zhCN, "zh-TW": zhTW, fr, es };

export function getDict(locale: Locale): Dict {
  return DICTS[locale] ?? en;
}

export function toLocale(v: string | undefined): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

// Locale for code without route params (server actions, route handlers).
export async function localeFromCookie(): Promise<Locale> {
  return toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
