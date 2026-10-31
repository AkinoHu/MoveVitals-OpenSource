export const LOCALES = ["en", "zh-CN", "zh-TW", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "mv_locale";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  fr: "Français",
  es: "Español",
};

// Short glyph shown in the language menu, written in the language itself.
export const LOCALE_GLYPH: Record<Locale, string> = { en: "EN", "zh-CN": "简", "zh-TW": "繁", fr: "FR", es: "ES" };

// Secondary label (English name), helpful when the native name is unfamiliar.
export const LOCALE_ENGLISH: Record<Locale, string> = {
  en: "English",
  "zh-CN": "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
  fr: "French",
  es: "Spanish",
};

// Open Graph locale codes.
export const OG_LOCALE: Record<Locale, string> = { en: "en_US", "zh-CN": "zh_CN", "zh-TW": "zh_TW", fr: "fr_FR", es: "es_ES" };

// Intl formatting locale.
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", "zh-CN": "zh-CN", "zh-TW": "zh-TW", fr: "fr-FR", es: "es-ES" };

export function isLocale(v: string | null | undefined): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

// Best supported locale for an Accept-Language header.
export function matchLocale(header: string | null | undefined): Locale {
  const tags = (header ?? "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((t) => t.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    if (/^zh-(tw|hk|mo|hant)/.test(tag)) return "zh-TW";
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("fr")) return "fr";
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}
