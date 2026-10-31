import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getDict, toLocale } from "@/i18n";
import { googleEnabled } from "@/lib/google";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = getDict(locale);
  return pageMetadata({ locale, path: "/login", title: t.meta.loginTitle, description: t.meta.description, index: false });
}

export default async function Page({ searchParams }: PageProps<"/[locale]/login">) {
  const error = (await searchParams).error;
  return <AuthForm mode="login" google={googleEnabled()} oauthError={typeof error === "string" ? error : undefined} />;
}
