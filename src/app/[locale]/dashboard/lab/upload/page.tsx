import { UploadReportForm } from "@/components/lab-forms";
import { PageHeader } from "@/components/page-header";
import { getDict, toLocale } from "@/i18n";
import { aiSettingsOf } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export default async function UploadLabReport({ params }: PageProps<"/[locale]/dashboard/lab/upload">) {
  const t = getDict(toLocale((await params).locale));
  const user = await requireUser();
  const settings = await aiSettingsOf(user.id);
  return (
    <>
      <PageHeader title={t.dash.lab.uploadTitle} description={t.dash.lab.uploadDesc} />
      <UploadReportForm model={settings ? settings.model : null} />
      <p className="mt-8 max-w-xl text-[12px] leading-relaxed text-faint">{t.dash.lab.disclaimer}</p>
    </>
  );
}
