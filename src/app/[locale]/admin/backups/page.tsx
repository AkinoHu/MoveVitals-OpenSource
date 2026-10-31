import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { Badge, Button } from "@/components/ui";
import { toLocale } from "@/i18n";
import { backupStorage } from "@/lib/backup";
import { db } from "@/lib/db";
import { backups } from "@/lib/db/schema";
import { backupNow } from "../actions";
import { adminDict } from "../strings";

export default async function AdminBackups({ params }: PageProps<"/[locale]/admin/backups">) {
  const d = adminDict(toLocale((await params).locale));
  const a = d.backups;
  const storage = backupStorage();
  const rows = await db.select().from(backups).orderBy(desc(backups.startedAt)).limit(60);
  const df = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", hour12: false });
  return (
    <div>
      <PageHeader
        title={d.nav.backups}
        description={a.lead}
        action={
          storage && (
            <form action={backupNow}>
              <Button>{a.runNow}</Button>
            </form>
          )
        }
      />
      <p className="mb-5 text-[13px] text-muted">
        {a.destination}: {storage ? <Badge>{storage === "s3" ? "S3 / R2" : "Volume"}</Badge> : <span className="text-danger">{a.none}</span>}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line p-10 text-center text-sm text-muted">{a.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                {Object.values(a.cols).map((c) => (
                  <th key={c} className="px-4 py-2.5 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum divide-y divide-line">
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2.5">{df.format(b.startedAt)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={b.status === "ok" ? "good" : b.status === "failed" ? "bad" : "neutral"}>{b.status}</Badge>
                    {b.error && <span className="ml-2 text-xs text-danger">{b.error}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{b.bytes ? `${(b.bytes / 1024 / 1024).toFixed(2)} MB` : "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{b.rows?.toLocaleString() ?? "—"}</td>
                  <td className="max-w-[320px] truncate px-4 py-2.5 font-mono text-[11.5px] text-faint">{b.location ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-5 text-[12.5px] text-muted">{a.restore}</p>
    </div>
  );
}
