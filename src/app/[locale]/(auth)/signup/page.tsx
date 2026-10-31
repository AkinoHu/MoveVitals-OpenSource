import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { getDict, toLocale } from "@/i18n";
import { googleEnabled } from "@/lib/google";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/signup">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = getDict(locale);
  return pageMetadata({ locale, path: "/signup", title: t.meta.signupTitle, description: t.meta.description, index: false });
}

export default async function Page({ searchParams }: PageProps<"/[locale]/signup">) {
  const error = (await searchParams).error;
  return <AuthForm mode="signup" google={googleEnabled()} oauthError={typeof error === "string" ? error : undefined} />;
}
