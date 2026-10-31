import { desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { disconnect, syncConnection } from "@/app/actions";
import { BrandIcon } from "@/components/brand/brand-icon";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { connections, syncRuns } from "@/lib/db/schema";
import { ADAPTERS, credentialsFor } from "@/lib/providers";
import { CATALOG, statusText } from "@/lib/providers/catalog";
import { fill, getDict, toLocale, type Dict } from "@/i18n";

export const metadata: Metadata = { title: "Connections" };



function timeAgo(d: Date | null, c: Dict["dash"]["connections"]): string {
  if (!d) return c.never;
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return c.justNow;
  if (m < 60) return fill(c.minAgo, { n: m });
  if (m < 1440) return fill(c.hAgo, { n: Math.round(m / 60) });
  return fill(c.dAgo, { n: Math.round(m / 1440) });
}

export default async function ConnectionsPage({ params, searchParams }: PageProps<"/[locale]/dashboard/connections">) {
  const locale = toLocale((await params).locale);
  const t = getDict(locale);
  const x = t.dash.connections;
  const copy = (id: string) => t.catalog[id as keyof Dict["catalog"]];
  const user = await requireUser();
  const sp = await searchParams;
  const conns = await db.select().from(connections).where(eq(connections.userId, user.id));
  const byProvider = new Map(conns.map((c) => [c.provider, c]));
  const runs = conns.length
    ? await db
        .select()
        .from(syncRuns)
        .where(
          inArray(
            syncRuns.connectionId,
            conns.map((c) => c.id),
          ),
        )
        .orderBy(desc(syncRuns.startedAt))
        .limit(50)
    : [];
  const lastRun = (id: string) => runs.find((r) => r.connectionId === id);

  const live = CATALOG.filter((c) => c.status === "live");
  const others = CATALOG.filter((c) => c.status !== "live");

  return (
    <>
      <PageHeader title={x.title} description={x.desc} />

      {sp.connected && <p className="mb-4 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{fill(x.connected, { p: String(sp.connected) })}</p>}
      {sp.error && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{x.errors[String(sp.error) as keyof typeof x.errors] ?? x.errors.default}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {live.map((c) => {
          const conn = byProvider.get(c.id);
          const configured = !!credentialsFor(ADAPTERS[c.id]);
          const run = conn && lastRun(conn.id);
          return (
            <Card
              key={c.id}
              title={
                <span className="flex items-center gap-2.5">
                  <BrandIcon id={c.id} size={22} color />
                  {c.name}
                  {c.owned && <Badge>{x.myDevice}</Badge>}
                </span>
              }
              action={
                conn ? (
                  <Badge tone={conn.status === "active" ? "good" : "bad"}>{conn.status === "active" ? x.statusActive : conn.status === "revoked" ? x.statusRevoked : x.statusError}</Badge>
                ) : (
                  <Badge>{configured ? x.notConnected : x.notConfigured}</Badge>
                )
              }
            >
              <p className="text-sm text-muted">{copy(c.id)?.data}</p>
              {c.aiRestricted && <p className="mt-1 text-xs text-warn">{x.stravaNote}</p>}
              {conn ? (
                <div className="mt-3 space-y-1 text-xs text-muted">
                  <p>
                    {fill(x.account, { a: conn.displayName ?? conn.externalUserId ?? "—", t: timeAgo(conn.lastSyncAt, x) })}
                  </p>
                  {run && (
                    <p>
                      {fill(x.lastRun, { s: run.status === "running" ? x.running : run.status === "ok" ? fill(x.ok, { o: run.stats.observations ?? 0, a: run.stats.activities ?? 0 }) : x.failed })}
                    </p>
                  )}
                  {conn.lastError && <p className="text-danger">{conn.lastError}</p>}
                </div>
              ) : null}
              <div className="mt-4 flex gap-2">
                {conn ? (
                  <>
                    <form action={syncConnection}>
                      <input type="hidden" name="id" value={conn.id} />
                      <Button variant="secondary">{x.syncNow}</Button>
                    </form>
                    {conn.status !== "active" && (
                      <a href={`/api/connections/${c.id}/authorize${conn.cursor?.region ? `?region=${conn.cursor.region}` : ""}`} className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
                        {x.reauth}
                      </a>
                    )}
                    <form action={disconnect} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={conn.id} />
                      <label className="flex items-center gap-1.5 text-[12px] text-muted">
                        <input type="checkbox" name="deleteData" /> {x.disconnectDeleteData}
                      </label>
                      <Button variant="danger">{x.disconnect}</Button>
                    </form>
                  </>
                ) : configured && c.id === "coros" ? (
                  // COROS accounts live on regional servers; default from the site language.
                  <form action="/api/connections/coros/authorize" className="flex flex-wrap items-center gap-2">
                    <select name="region" aria-label={x.region} defaultValue={locale.startsWith("zh") ? "cn" : locale === "fr" || locale === "es" ? "eu" : "us"} className="h-8 rounded-md border border-line bg-surface px-2 text-[13px]">
                      {(["cn", "eu", "us"] as const).map((r) => (
                        <option key={r} value={r}>
                          {x.regions[r]}
                        </option>
                      ))}
                    </select>
                    <button className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">{fill(x.connect, { p: c.name })}</button>
                  </form>
                ) : configured ? (
                  <a href={`/api/connections/${c.id}/authorize`} className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
                    {fill(x.connect, { p: c.name })}
                  </a>
                ) : (
                  <p className="text-xs text-muted">
                    {fill(x.adminHint, { a: `${ADAPTERS[c.id].envPrefix}_CLIENT_ID`, b: `${ADAPTERS[c.id].envPrefix}_CLIENT_SECRET` })}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="mt-10 mb-3 text-sm font-semibold">{x.others}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {others.map((c) => (
          <div key={c.id} className="group rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2.5 text-sm font-medium">
                <BrandIcon id={c.id} size={20} />
                {c.name}
              </span>
              <Badge tone={c.status === "blocked" ? "bad" : c.status === "planned" ? "warn" : "neutral"}>{statusText(c, t.status, t.statusVia)}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted">{copy(c.id)?.path}</p>
            <p className="mt-2 text-[11px] text-muted">{fill(x.apiLabel, { a: t.access[c.access] })}</p>
          </div>
        ))}
      </div>
    </>
  );
}
