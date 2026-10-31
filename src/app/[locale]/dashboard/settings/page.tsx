import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { deleteApiToken, resendVerification, unlinkAccount } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { CloudSyncSwitch, DeleteAccountForm, ProfileForm, SetPasswordForm, TokenForm } from "@/components/settings-forms";
import { Button, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { fill, getDict, toLocale } from "@/i18n";
import { INTL_LOCALE } from "@/i18n/config";
import { db } from "@/lib/db";
import { apiTokens, authAccounts, userAttributes, users } from "@/lib/db/schema";
import { googleEnabled } from "@/lib/google";
import { mailEnabled } from "@/lib/mail";
import { AvatarUploader, BodyProfileForm } from "@/components/profile-forms";
import { isAttributeKey } from "@/lib/attributes";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params, searchParams }: PageProps<"/[locale]/dashboard/settings">) {
  const locale = toLocale((await params).locale);
  const flash = await searchParams;
  const dict = getDict(locale);
  const x = dict.dash.settings;
  const user = await requireUser();
  const [tokens, attrRows, accounts, [account]] = await Promise.all([
    db.select().from(apiTokens).where(eq(apiTokens.userId, user.id)).orderBy(desc(apiTokens.createdAt)),
    db.select().from(userAttributes).where(eq(userAttributes.userId, user.id)),
    db.select().from(authAccounts).where(eq(authAccounts.userId, user.id)),
    db.select({ hasPassword: users.passwordHash, cloudSync: users.cloudSync }).from(users).where(eq(users.id, user.id)),
  ]);
  const google = accounts.find((a) => a.provider === "google");
  const hasPassword = !!account?.hasPassword;
  const attrs = Object.fromEntries(attrRows.filter((a) => isAttributeKey(a.key)).map((a) => [a.key, { value: a.value, source: a.source }]));

  return (
    <>
      <PageHeader title={x.title} />
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card title={x.profile}>
          <AvatarUploader updatedAt={user.avatarUpdatedAt} />
          <p className="mt-5 mb-1 text-sm text-muted">
            {user.email} · {user.emailVerified ? x.emailVerified : x.emailUnverified}
          </p>
          {!user.emailVerified && mailEnabled() && (
            <form action={resendVerification} className="mb-3">
              <Button variant="ghost" className="text-xs">
                {x.resendVerification}
              </Button>
            </form>
          )}
          {flash.verified && <p className="mb-3 text-sm text-accent">{x.verifiedOk}</p>}
          {flash.sent && <p className="mb-3 text-sm text-accent">{x.verificationSent}</p>}
          {flash.verify_error && <p className="mb-3 text-sm text-danger">{x.verifyError}</p>}
          <ProfileForm name={user.name} timezone={user.timezone} units={user.units} />
        </Card>

        <Card title={x.sync}>
          <CloudSyncSwitch enabled={account?.cloudSync ?? true} />
        </Card>

        <Card title={x.signIn}>
          <ul className="divide-y divide-line text-sm">
            <li className="flex items-center justify-between py-2">
              <span>{x.signInEmail}</span>
              <span className="text-xs text-muted">{hasPassword ? x.linked : x.notLinked}</span>
            </li>
            <li className="flex items-center justify-between py-2">
              <span>
                {x.signInGoogle}
                {google?.email && <span className="ml-2 text-xs text-muted">{google.email}</span>}
              </span>
              {google ? (
                (hasPassword || accounts.length > 1) && (
                  <form action={unlinkAccount}>
                    <input type="hidden" name="provider" value="google" />
                    <Button variant="ghost" className="text-xs">
                      {x.unlink}
                    </Button>
                  </form>
                )
              ) : googleEnabled() ? (
                // eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth round trip
                <a href="/api/auth/google/start?link=1" className="text-xs font-medium text-ink underline underline-offset-2">
                  {x.link}
                </a>
              ) : (
                <span className="text-xs text-faint">{x.notLinked}</span>
              )}
            </li>
          </ul>
          <div className="mt-4">
            <SetPasswordForm hasPassword={hasPassword} />
          </div>
        </Card>

        <Card title={x.body}>
          <p className="mb-4 text-sm leading-relaxed text-muted">{x.bodyDesc}</p>
          <BodyProfileForm attrs={attrs} units={user.units} />
        </Card>

        <Card title={x.tokens}>
          <p className="mb-3 text-sm text-muted">
            {x.tokensDesc} <code className="font-mono text-xs">POST /api/ingest</code>.
          </p>
          <TokenForm />
          {tokens.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <span>
                    {t.name}
                    <span className="ml-2 text-xs text-muted">{t.lastUsedAt ? fill(x.lastUsed, { d: t.lastUsedAt.toLocaleDateString(INTL_LOCALE[locale]) }) : x.unused}</span>
                  </span>
                  <form action={deleteApiToken}>
                    <input type="hidden" name="id" value={t.id} />
                    <Button variant="ghost" className="text-xs">
                      {x.revoke}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={x.export}>
          <p className="mb-3 text-sm text-muted">
            {x.exportDesc} {x.backupNote}
          </p>
          {/* A file download from a route handler, not a page navigation. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/export" className="inline-flex rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
            {x.exportBtn}
          </a>
        </Card>

        <Card title={x.delete}>
          <DeleteAccountForm email={user.email} />
        </Card>
      </div>
    </>
  );
}
