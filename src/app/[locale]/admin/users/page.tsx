import { desc, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui";
import { toLocale } from "@/i18n";
import { db } from "@/lib/db";
import { authAccounts, connections, users } from "@/lib/db/schema";
import { adminDict } from "../strings";

// Account overview only — health data itself is never shown here.
export default async function AdminUsers({ params }: PageProps<"/[locale]/admin/users">) {
  const d = adminDict(toLocale((await params).locale));
  const a = d.users;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
      cloudSync: users.cloudSync,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      providers: sql<string[]>`coalesce((select array_agg(${authAccounts.provider}) from ${authAccounts} where ${authAccounts.userId} = ${users.id}), '{}')`,
      connections: sql<number>`(select count(*)::int from ${connections} where ${connections.userId} = ${users.id})`,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(500);
  const df = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  return (
    <div>
      <PageHeader title={d.nav.users} description={`${a.lead} · ${rows.length}`} />
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
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2.5 font-medium">{u.email}</td>
                <td className="px-4 py-2.5 text-muted">{u.name ?? "—"}</td>
                <td className="space-x-1 px-4 py-2.5">
                  {u.hasPassword && <Badge>email</Badge>}
                  {u.providers.map((p) => (
                    <Badge key={p}>{p}</Badge>
                  ))}
                </td>
                <td className="px-4 py-2.5">{u.cloudSync ? a.on : a.off}</td>
                <td className="px-4 py-2.5 text-muted">{u.connections}</td>
                <td className="px-4 py-2.5 text-muted">{u.lastLoginAt ? df.format(u.lastLoginAt) : "—"}</td>
                <td className="px-4 py-2.5 text-muted">{df.format(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
