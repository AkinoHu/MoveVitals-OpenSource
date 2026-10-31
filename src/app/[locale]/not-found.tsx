"use client";

import { ButtonLink } from "@/components/ui";
import { useI18n } from "@/i18n/client";

export default function NotFound() {
  const { t, locale } = useI18n();
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="font-mono text-sm text-faint">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">{t.common.notFoundTitle}</h1>
      <p className="mt-3 text-muted">{t.common.notFoundBody}</p>
      <ButtonLink href={`/${locale}`} className="mt-8">
        {t.common.backHome}
      </ButtonLink>
    </main>
  );
}
