"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { LOCALES, LOCALE_COOKIE, LOCALE_ENGLISH, LOCALE_GLYPH, LOCALE_NAMES, isLocale, type Locale } from "@/i18n/config";

type Pref = "system" | "light" | "dark";

function apply(pref: Pref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  document.cookie = pref === "system" ? "mv_theme=; path=/; max-age=0" : `mv_theme=${pref}; path=/; max-age=31536000; samesite=lax`;
}

const ICONS: Record<Pref, React.ReactNode> = {
  system: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
};

export function ThemeToggle() {
  const { t } = useI18n();
  const [pref, setPref] = useState<Pref>("system");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPref(current === "dark" || current === "light" ? current : "system");
  }, []);

  const choose = (p: Pref) => {
    setPref(p);
    apply(p);
  };

  const label: Record<Pref, string> = { system: t.common.themeSystem, light: t.common.themeLight, dark: t.common.themeDark };
  return (
    <div role="radiogroup" aria-label={t.common.theme} className="inline-flex items-center rounded-full border border-line p-0.5">
      {(["system", "light", "dark"] as Pref[]).map((p) => (
        <button
          key={p}
          role="radio"
          aria-checked={pref === p}
          aria-label={label[p]}
          title={label[p]}
          onClick={() => choose(p)}
          className={`grid size-6 place-items-center rounded-full transition ${pref === p ? "bg-surface-3 text-ink" : "text-faint hover:text-ink"}`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {ICONS[p]}
          </svg>
        </button>
      ))}
    </div>
  );
}

function rememberLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

function Glyph({ locale, active = false }: { locale: Locale; active?: boolean }) {
  return (
    <span
      aria-hidden
      lang={locale}
      className={`grid h-5 min-w-5 place-items-center rounded-[5px] px-1 text-[10.5px] leading-none font-semibold ${
        active ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink"
      }`}
    >
      {LOCALE_GLYPH[locale]}
    </span>
  );
}

// Language menu. `placement="up"` for spots near the bottom of the screen
// (footer, sidebar).
export function LanguageSwitcher({ className = "", placement = "down" }: { className?: string; placement?: "up" | "down" }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) items.current[focus]?.focus();
  }, [open, focus]);

  const change = (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    rememberLocale(next);
    const [, first, ...rest] = pathname.split("/");
    if (isLocale(first)) router.push(`/${next}${rest.length ? `/${rest.join("/")}` : ""}${window.location.search}`);
    else router.refresh(); // unprefixed app routes read the cookie
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocus((f) => (f + 1) % LOCALES.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocus((f) => (f - 1 + LOCALES.length) % LOCALES.length);
    }
  };

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={onKey}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t.common.language}: ${LOCALE_NAMES[locale]}`}
        onClick={() => {
          setFocus(LOCALES.indexOf(locale));
          setOpen((o) => !o);
        }}
        className={`flex h-8 items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold tracking-wide transition ${
          open ? "border-line-strong bg-surface-2 text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink"
        }`}
      >
        <span lang={locale}>{LOCALE_GLYPH[locale]}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden className={`transition ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t.common.language}
          className={`absolute z-50 w-56 rounded-xl border border-line bg-surface p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)] ${
            placement === "up" ? "bottom-full mb-2" : "top-full mt-2"
          } ${className.includes("right") ? "right-0" : "left-0"}`}
        >
          {LOCALES.map((l, i) => {
            const active = l === locale;
            return (
              <li key={l} role="option" aria-selected={active}>
                <button
                  ref={(el) => {
                    items.current[i] = el;
                  }}
                  type="button"
                  lang={l}
                  onClick={() => change(l)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition hover:bg-surface-2 focus-visible:bg-surface-2 ${active ? "bg-surface-2" : ""}`}
                >
                  <Glyph locale={l} active={active} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{LOCALE_NAMES[l]}</span>
                    <span className="block text-[11px] text-faint">{LOCALE_ENGLISH[l]}</span>
                  </span>
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" aria-hidden>
                      <path d="M5 12.5 10 17.5 19 7" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
