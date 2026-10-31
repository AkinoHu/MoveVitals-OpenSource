import { AddResultForm } from "@/components/lab-forms";
import { PageHeader } from "@/components/page-header";
import { getDict, toLocale } from "@/i18n";
import { getLabCopy } from "@/i18n/lab";
import { requireUser } from "@/lib/auth";
import { markerOptions } from "@/lib/lab/options";
import { dayInTz } from "@/lib/time";

export default async function AddLabResult({ params, searchParams }: PageProps<"/[locale]/dashboard/lab/add">) {
  const locale = toLocale((await params).locale);
  const t = getDict(locale);
  const user = await requireUser();
  const { marker } = (await searchParams) as { marker?: string };
  return (
    <>
      <PageHeader title={t.dash.lab.addTitle} description={t.dash.lab.addDesc} />
      <AddResultForm markers={markerOptions(getLabCopy(locale))} initial={marker} today={dayInTz(new Date(), user.timezone)} />
      <p className="mt-8 max-w-xl text-[12px] leading-relaxed text-faint">{t.dash.lab.disclaimer}</p>
    </>
  );
}
