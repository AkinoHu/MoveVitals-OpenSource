import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { AISettingsForm, AskForm } from "@/components/ai-forms";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui";
import { aiPresets, buildContext } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { getDict, toLocale } from "@/i18n";
import { db } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { CATALOG } from "@/lib/providers/catalog";

export const metadata: Metadata = { title: "AI analysis" };

export default async function AIPage({ params }: PageProps<"/[locale]/dashboard/ai">) {
  const t = getDict(toLocale((await params).locale));
  const x = t.dash.ai;
  const user = await requireUser();
  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.userId, user.id));
  const context = await buildContext(user.id, user.timezone, 14, settings ?? {});
  const sources = CATALOG.filter((c) => c.status !== "blocked" && c.status !== "planned").map((c) => ({ id: c.id, name: c.name, restricted: !!c.aiRestricted }));

  return (
    <>
      <PageHeader title={x.title} description={x.desc} />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_400px] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card title={x.ask}>
            <AskForm enabled={!!settings} />
          </Card>
          <Card title={x.preview}>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted">{context}</pre>
          </Card>
        </div>
        <Card title={x.config}>
          <AISettingsForm
            presets={aiPresets()}
            current={
              settings
                ? { kind: settings.kind, baseUrl: settings.baseUrl, model: settings.model, allowedProviders: settings.allowedProviders, includeProfile: settings.includeProfile, includeLabs: settings.includeLabs, includeNames: settings.includeNames }
                : null
            }
            sources={sources}
          />
        </Card>
      </div>
    </>
  );
}
