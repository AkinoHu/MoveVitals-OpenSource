// Restore a MoveVitals backup into the database at DATABASE_URL.
//
//   pnpm tsx scripts/restore-backup.ts path/to/movevitals-….mvbk --yes
//
// Needs the same BACKUP_ENCRYPTION_KEY (or ENCRYPTION_KEY) that created the
// backup. ALL existing rows in the backed-up tables are replaced. Restore into
// an empty database first if you only want to inspect a backup.
import { readFile } from "node:fs/promises";
import { and, eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn } from "drizzle-orm/pg-core";
import { migrate, db } from "../src/lib/db";
import { backupTables, parseBackup } from "../src/lib/backup";

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file || flag !== "--yes") {
    console.error("usage: tsx scripts/restore-backup.ts <file.mvbk> --yes");
    process.exit(1);
  }
  await migrate();
  const { header, rows } = parseBackup(await readFile(file));
  console.log(`backup from ${header.createdAt}, ${header.tables.length} tables`);
  const tables = backupTables();

  // Circular or forward foreign keys (e.g. activities <-> activity_groups): the
  // nullable columns that point at a table not yet restored are inserted as
  // NULL and filled in once every table is in.
  const order = new Map(tables.map((t, i) => [getTableName(t), i]));
  const deferredCols = (t: (typeof tables)[number]): string[] => {
    const me = order.get(getTableName(t))!;
    const cols = getTableColumns(t);
    const out: string[] = [];
    for (const fk of getTableConfig(t).foreignKeys) {
      const ref = fk.reference();
      if ((order.get(getTableName(ref.foreignTable)) ?? -1) < me) continue;
      for (const c of ref.columns) {
        const key = Object.keys(cols).find((k) => cols[k] === c);
        if (key && !c.notNull) out.push(key);
      }
    }
    return out;
  };
  const pkOf = (t: (typeof tables)[number]): string[] => {
    const cols = getTableColumns(t);
    const composite = getTableConfig(t).primaryKeys[0]?.columns as AnyPgColumn[] | undefined;
    const list = composite ?? Object.values(cols).filter((c) => c.primary);
    return list.map((c) => Object.keys(cols).find((k) => cols[k] === c)!);
  };

  await db.transaction(async (tx) => {
    // Children first when deleting, parents first when inserting.
    for (const t of [...tables].reverse()) await tx.execute(sql`DELETE FROM ${t}`);
    const later: { t: (typeof tables)[number]; cols: string[]; rows: Record<string, unknown>[] }[] = [];
    for (const t of tables) {
      const list = rows.get(getTableName(t)) ?? [];
      const cols = getTableColumns(t);
      const deferred = deferredCols(t);
      // JSON turned timestamps into strings; bring them back to Date.
      const revive = (r: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cols[k]?.dataType === "date" && typeof v === "string" ? new Date(v) : v]));
      if (deferred.length) later.push({ t, cols: deferred, rows: list });
      const prepared = list.map((r) => revive(deferred.length ? { ...r, ...Object.fromEntries(deferred.map((k) => [k, null])) } : r));
      for (let i = 0; i < prepared.length; i += 500) await tx.insert(t).values(prepared.slice(i, i + 500));
      console.log(`  ${getTableName(t)}: ${list.length}`);
    }
    for (const { t, cols: deferred, rows: list } of later) {
      const cols = getTableColumns(t);
      const pk = pkOf(t);
      for (const r of list) {
        const set = Object.fromEntries(deferred.filter((k) => r[k] != null).map((k) => [k, r[k]]));
        if (Object.keys(set).length === 0) continue;
        await tx.update(t).set(set).where(and(...pk.map((k) => eq(cols[k], r[k] as never))));
      }
    }
  });
  console.log("restore complete");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.message.slice(0, 200)}\n${(e.cause as Error | undefined)?.message ?? ""}` : e);
  process.exit(1);
});
