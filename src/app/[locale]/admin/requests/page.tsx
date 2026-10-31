import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui";
import { toLocale } from "@/i18n";
import { db } from "@/lib/db";
import { integrationRequests } from "@/lib/db/schema";
import { setRequestStatus } from "../actions";
import { adminDict } from "../strings";

const STATUSES = ["new", "planned", "done", "declined"] as const;

export default async function AdminRequests({ params }: PageProps<"/[locale]/admin/requests">) {
  const d = adminDict(toLocale((await params).locale));
  const a = d.requests;
  const rows = await db.select().from(integrationRequests).orderBy(desc(integrationRequests.createdAt)).limit(500);
  const df = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  return (
    <div>
      <PageHeader title={d.nav.requests} description={`${a.lead} · ${rows.length}`} />
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
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2.5 font-medium">
                    {r.device}
                    {r.link && (
                      <a href={r.link} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-[11.5px] font-normal text-muted hover:text-ink">
                        {r.link}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge>{r.kind}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.email ?? "—"}</td>
                  <td className="max-w-[360px] px-4 py-2.5 whitespace-pre-wrap text-muted">{r.message ?? "—"}</td>
                  <td className="tnum px-4 py-2.5 text-muted">
                    {df.format(r.createdAt)}
                    <span className="block text-[11px] text-faint">{r.locale}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <form action={setRequestStatus} className="flex flex-wrap gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          name="status"
                          value={s}
                          className={`rounded px-1.5 py-0.5 text-[11px] ${r.status === s ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink"}`}
                        >
                          {s}
                        </button>
                      ))}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
