"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "@/app/actions";
import { useI18n } from "@/i18n/client";
import { tr } from "@/i18n/translate";
import { Captcha } from "./captcha";
import { Button, Input, Label } from "./ui";

// Official Google "G" mark (brand guidelines: keep the four colours).
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

export function AuthForm({ mode, google = false, oauthError }: { mode: "login" | "signup"; google?: boolean; oauthError?: string }) {
  const { t, locale } = useI18n();
  const a = t.auth;
  const [state, action, pending] = useActionState(mode === "login" ? login : signup, undefined);
  const link = "font-medium text-ink underline underline-offset-2";
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">{mode === "login" ? a.loginHeading : a.signupHeading}</h1>
      {oauthError && (
        <p role="alert" className="text-sm text-danger">
          {a.oauthErrors[oauthError as keyof typeof a.oauthErrors] ?? a.oauthErrors.google_failed}
        </p>
      )}
      {google && (
        <>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route, full navigation */}
          <a
            href="/api/auth/google/start"
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface text-sm font-medium transition hover:border-line-strong hover:bg-surface-2"
          >
            <GoogleMark />
            {a.google}
          </a>
          <div className="flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" />
            {a.or}
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      {mode === "signup" && (
        <label className="block">
          <Label>{a.name}</Label>
          <Input name="name" autoComplete="nickname" />
        </label>
      )}
      <label className="block">
        <Label>{a.email}</Label>
        <Input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="block">
        <Label hint={mode === "signup" ? a.passwordHint : undefined}>{a.password}</Label>
        <Input name="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} />
      </label>
      {mode === "signup" && process.env.NEXT_PUBLIC_PRIVACY_URL && process.env.NEXT_PUBLIC_TERMS_URL && (
        <label className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <input type="checkbox" name="agree" className="mt-0.5 accent-[var(--accent)]" required />
          <span>
            {a.agreeA}{" "}
            <Link href={process.env.NEXT_PUBLIC_PRIVACY_URL} className={link} target="_blank">
              {a.agreePrivacy}
            </Link>{" "}
            {a.agreeAnd}{" "}
            <Link href={process.env.NEXT_PUBLIC_TERMS_URL} className={link} target="_blank">
              {a.agreeTerms}
            </Link>
            {a.agreeB}
          </span>
        </label>
      )}
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {tr(t, state.error)}
        </p>
      )}
      {mode === "signup" && <Captcha />}
      <Button type="submit" disabled={pending} className="h-9 w-full">
        {pending ? a.wait : mode === "login" ? a.submitLogin : a.submitSignup}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            {a.noAccount}{" "}
            <Link href={`/${locale}/signup`} className={link}>
              {t.common.signup}
            </Link>
          </>
        ) : (
          <>
            {a.haveAccount}{" "}
            <Link href={`/${locale}/login`} className={link}>
              {t.common.login}
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
