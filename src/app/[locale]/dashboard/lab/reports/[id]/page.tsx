import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { DeleteReportButton, ReviewForm } from "@/components/lab-forms";
import { PageHeader } from "@/components/page-header";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { fill, getDict, toLocale } from "@/i18n";
import { getLabCopy } from "@/i18n/lab";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { labReports } from "@/lib/db/schema";
import { markerOptions } from "@/lib/lab/options";

export default async function LabReportPage({ params }: PageProps<"/[locale]/dashboard/lab/reports/[id]">) {
  const { locale: raw, id } = await params;
  const locale = toLocale(raw);
  const t = getDict(locale);
  const x = t.dash.lab;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [r] = await db
    .select({ id: labReports.id, kind: labReports.kind, title: labReports.title, takenOn: labReports.takenOn, status: labReports.status, extracted: labReports.extracted, error: labReports.error, filename: labReports.filename })
    .from(labReports)
    .where(and(eq(labReports.id, id), eq(labReports.userId, user.id)));
  if (!r) notFound();

  return (
    <>
      <PageHeader
        title={r.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {x.kinds[r.kind as keyof typeof x.kinds]}
            {r.takenOn && <span>· {r.takenOn}</span>}
            <Badge tone={r.status === "extracted" || r.status === "failed" ? "warn" : "neutral"}>{x.status[r.status as keyof typeof x.status] ?? r.status}</Badge>
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/lab/reports/${r.id}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-surface-2">
              {x.openFile}
            </a>
            <DeleteReportButton id={r.id} />
          </div>
        }
      />
      {r.status === "failed" && <p className="mb-6 rounded-lg border border-warn/30 bg-warn-bg p-4 text-[13px] text-warn">{fill(x.readFailed, { e: r.error ?? "" })}</p>}
      {r.status === "extracted" && r.extracted && r.extracted.length > 0 && (
        <Card title={x.reviewTitle}>
          <p className="mb-4 text-[13px] text-muted">{x.reviewDesc}</p>
          <ReviewForm reportId={r.id} rows={r.extracted} markers={markerOptions(getLabCopy(locale))} takenOn={r.takenOn} />
        </Card>
      )}
      {((r.status === "extracted" && !r.extracted?.length) || r.status === "failed" || r.status === "stored") && (
        <div className="mt-4">
          {r.status === "extracted" && <p className="mb-3 text-[13px] text-muted">{x.noValues}</p>}
          <ButtonLink href="/dashboard/lab/add">{x.addResult}</ButtonLink>
        </div>
      )}
    </>
  );
}
