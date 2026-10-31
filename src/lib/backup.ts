// Encrypted logical backups of the whole database.
//
// Format: gzip(NDJSON) encrypted with AES-256-GCM. The first line is a header
// ({"format":"movevitals-backup","version":1,...}); every other line is
// {"t": table, "r": row}. Tables are written in dependency order so a restore
// can insert parents before children. Backups are produced as a stream (rows
// are read in pages and piped through gzip and the cipher into a file), so
// memory use does not grow with the size of the database.
//
// File layout: "MVBK2" | iv (12) | ciphertext | GCM tag (16). Files written by
// older versions ("MVBK1" | iv | tag | ciphertext) can still be read.
//
// Destinations (first match wins):
//   S3-compatible storage (Cloudflare R2, S3…): BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET,
//     BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY [, BACKUP_S3_REGION]
//   Local directory (e.g. a Railway volume): BACKUP_DIR
// Key: BACKUP_ENCRYPTION_KEY (32 bytes, base64). Set it to a value that is NOT
// ENCRYPTION_KEY, so a leaked backup bucket and a leaked app secret are
// different incidents. If it is unset, a key derived (HKDF) from
// ENCRYPTION_KEY is used - still distinct from the key that protects tokens.
// Keep a copy of the key somewhere safe — without it a backup can't be read.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { asc, desc, eq, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable, type AnyPgColumn } from "drizzle-orm/pg-core";
import { deriveKey } from "./crypto";
import { db } from "./db";
import * as schema from "./db/schema";
import { backups } from "./db/schema";
import { withLease } from "./locks";

const MAGIC_V1 = Buffer.from("MVBK1");
const MAGIC = Buffer.from("MVBK2");
const PAGE = 1000;
const RETAIN = Number(process.env.BACKUP_RETAIN ?? 30);

// Tables in dependency order (referenced tables first). Module namespace
// objects list exports alphabetically, so the order is derived from the
// foreign keys rather than from the schema file.
export function backupTables(): PgTable[] {
  // Backups never contain the backup log itself or throwaway login state.
  const skip = new Set(["backups", "login_states", "oauth_states"]);
  const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable) && !skip.has(getTableName(v)));
  const byName = new Map(tables.map((t) => [getTableName(t), t]));
  const ordered: PgTable[] = [];
  const seen = new Set<string>();
  const visit = (t: PgTable) => {
    const name = getTableName(t);
    if (seen.has(name)) return;
    seen.add(name);
    for (const fk of getTableConfig(t).foreignKeys) {
      const parent = byName.get(getTableName(fk.reference().foreignTable));
      if (parent && parent !== t) visit(parent);
    }
    ordered.push(t);
  };
  tables.forEach(visit);
  return ordered;
}

// Candidate keys, newest scheme first. Only the first is used to encrypt; the
// rest let older backups (made with ENCRYPTION_KEY itself) still be restored.
function backupKeys(): Buffer[] {
  const out: Buffer[] = [];
  const explicit = process.env.BACKUP_ENCRYPTION_KEY;
  if (explicit) {
    const k = Buffer.from(explicit, "base64");
    if (k.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    out.push(k);
  }
  try {
    out.push(deriveKey("backup"));
    const legacy = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
    if (legacy.length === 32) out.push(legacy);
  } catch {
    // ENCRYPTION_KEY missing: handled below.
  }
  if (out.length === 0) {
    if (process.env.NODE_ENV === "production") throw new Error("BACKUP_ENCRYPTION_KEY (or ENCRYPTION_KEY) is required");
    out.push(createHash("sha256").update("movevitals-insecure-dev-key").digest());
  }
  return out;
}

// Streaming AES-256-GCM: emits MAGIC + iv first and the auth tag last.
class EncryptStream extends Transform {
  private cipher;
  constructor(key: Buffer) {
    super();
    const iv = randomBytes(12);
    this.cipher = createCipheriv("aes-256-gcm", key, iv);
    this.push(Buffer.concat([MAGIC, iv]));
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null, d?: Buffer) => void) {
    cb(null, this.cipher.update(chunk));
  }
  _flush(cb: (e?: Error | null) => void) {
    this.push(this.cipher.final());
    this.push(this.cipher.getAuthTag());
    cb();
  }
}

export function encryptBackup(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", backupKeys()[0], iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, data, c.getAuthTag()]);
}

export function decryptBackup(file: Buffer): Buffer {
  const v2 = file.subarray(0, MAGIC.length).equals(MAGIC);
  if (!v2 && !file.subarray(0, MAGIC_V1.length).equals(MAGIC_V1)) throw new Error("not a MoveVitals backup");
  const iv = file.subarray(5, 17);
  const tag = v2 ? file.subarray(file.length - 16) : file.subarray(17, 33);
  const data = v2 ? file.subarray(17, file.length - 16) : file.subarray(33);
  let last: unknown;
  for (const key of backupKeys()) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data), d.final()]);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`could not decrypt backup (wrong BACKUP_ENCRYPTION_KEY?): ${last instanceof Error ? last.message : last}`);
}

export const backupStorage = (): "s3" | "local" | null =>
  process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_ENDPOINT ? "s3" : process.env.BACKUP_DIR ? "local" : null;

async function s3() {
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({
    accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY!,
    service: "s3",
    region: process.env.BACKUP_S3_REGION ?? "auto",
  });
  const base = `${process.env.BACKUP_S3_ENDPOINT!.replace(/\/$/, "")}/${process.env.BACKUP_S3_BUCKET}`;
  return { client, base };
}

// Moves a finished backup file to its destination. `file` is a temp file on
// local disk; for S3 it is streamed up (never loaded into memory) and removed.
async function store(name: string, file: string, size: number): Promise<string> {
  if (backupStorage() === "s3") {
    const { client, base } = await s3();
    const key = `backups/${name}`;
    // Signed without a body: aws4fetch marks S3 requests UNSIGNED-PAYLOAD, so the
    // file can be streamed. Sent with node:https rather than fetch because the
    // patched fetch in Next.js streams without Content-Length, which R2 rejects (411).
    const signed = await client.sign(`${base}/${key}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" } });
    const res = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const headers = Object.fromEntries(signed.headers);
      const req = httpsRequest(signed.url, { method: "PUT", headers: { ...headers, "Content-Length": String(size) }, timeout: 30 * 60_000 }, (r) => {
        let text = "";
        r.setEncoding("utf8");
        r.on("data", (c: string) => (text += c.length < 2000 ? c : ""));
        r.on("end", () => resolve({ status: r.statusCode ?? 0, text }));
      });
      req.on("timeout", () => req.destroy(new Error("upload timed out")));
      req.on("error", reject);
      createReadStream(file).on("error", reject).pipe(req);
    });
    await rm(file, { force: true });
    if (res.status < 200 || res.status >= 300) throw new Error(`upload failed: ${res.status} ${res.text}`.slice(0, 300));
    return key;
  }
  const dir = process.env.BACKUP_DIR!;
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, name);
  try {
    await rename(file, dest);
  } catch {
    // Different filesystem: copy then remove.
    await pipeline(createReadStream(file), createWriteStream(dest));
    await rm(file, { force: true });
  }
  return dest;
}

// Keep the newest RETAIN backups at the destination.
async function prune() {
  const old = await db.select({ id: backups.id, location: backups.location, storage: backups.storage }).from(backups).where(eq(backups.status, "ok")).orderBy(desc(backups.startedAt)).offset(RETAIN);
  for (const b of old) {
    try {
      if (b.storage === "s3" && b.location) {
        const { client, base } = await s3();
        await client.fetch(`${base}/${b.location}`, { method: "DELETE" });
      } else if (b.location) await rm(b.location, { force: true });
    } catch (e) {
      console.error("[backup] prune failed", b.location, e);
    }
    await db.delete(backups).where(eq(backups.id, b.id));
  }
  // Remove stray local files that no longer have a log row.
  if (backupStorage() === "local") {
    const keep = new Set((await db.select({ l: backups.location }).from(backups)).map((r) => r.l));
    for (const f of await readdir(process.env.BACKUP_DIR!).catch(() => [] as string[])) {
      const p = path.join(process.env.BACKUP_DIR!, f);
      if (f.endsWith(".mvbk") && !keep.has(p)) await rm(p, { force: true });
      // Leftovers of a crashed run (a live run is at most a few minutes old).
      if (f.endsWith(".partial") && Date.now() - (await stat(p)).mtimeMs > 3600_000) await rm(p, { force: true });
    }
  }
}

// Stable page order: the primary key (single or composite), else the first column.
function orderColumns(table: PgTable): AnyPgColumn[] {
  const cfg = getTableConfig(table);
  const composite = cfg.primaryKeys[0]?.columns;
  if (composite?.length) return composite as AnyPgColumn[];
  const single = cfg.columns.filter((c) => c.primary);
  return (single.length ? single : cfg.columns.slice(0, 1)) as AnyPgColumn[];
}

async function* backupLines(tables: PgTable[], count: { rows: number }): AsyncGenerator<string> {
  yield JSON.stringify({ format: "movevitals-backup", version: 1, createdAt: new Date(), tables: tables.map((t) => getTableName(t)) }) + "\n";
  for (const table of tables) {
    const name = getTableName(table);
    const order = orderColumns(table).map((c) => asc(c));
    for (let offset = 0; ; offset += PAGE) {
      const page = await db.select().from(table).orderBy(...order).limit(PAGE).offset(offset);
      if (page.length) yield page.map((r) => JSON.stringify({ t: name, r }) + "\n").join("");
      count.rows += page.length;
      if (page.length < PAGE) break;
    }
  }
}

export async function runBackup(): Promise<{ id: string; ok: boolean; error?: string }> {
  const storage = backupStorage();
  if (!storage) return { id: "", ok: false, error: "no_destination" };
  // One backup at a time across the web app and the worker.
  const res = await withLease("backup", () => runBackupLocked(storage), { ttlMs: 15 * 60_000 });
  return res.acquired ? res.value : { id: "", ok: false, error: "already_running" };
}

async function runBackupLocked(storage: "s3" | "local"): Promise<{ id: string; ok: boolean; error?: string }> {
  const [log] = await db.insert(backups).values({ storage }).returning({ id: backups.id });
  const name = `movevitals-${new Date().toISOString().replace(/[:.]/g, "-")}.mvbk`;
  // Written next to the destination when local (cheap rename), otherwise in tmp.
  const tmpDir = storage === "local" ? process.env.BACKUP_DIR! : os.tmpdir();
  const tmp = path.join(tmpDir, `${name}.partial`);
  try {
    await mkdir(tmpDir, { recursive: true });
    const tables = backupTables();
    const count = { rows: 0 };
    await pipeline(Readable.from(backupLines(tables, count)), createGzip({ level: 6 }), new EncryptStream(backupKeys()[0]), createWriteStream(tmp, { mode: 0o600 }));
    const { size } = await stat(tmp);
    const location = await store(name, tmp, size);
    await db.update(backups).set({ status: "ok", location, bytes: size, tables: tables.length, rows: count.rows, finishedAt: new Date() }).where(eq(backups.id, log.id));
    await prune();
    return { id: log.id, ok: true };
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    const error = e instanceof Error ? e.message : String(e);
    await db.update(backups).set({ status: "failed", error: error.slice(0, 500), finishedAt: new Date() }).where(eq(backups.id, log.id));
    return { id: log.id, ok: false, error };
  }
}

// True when the last successful backup is older than the interval.
export async function backupDue(hours = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24)): Promise<boolean> {
  if (!backupStorage()) return false;
  const [last] = await db.select({ at: backups.startedAt, status: backups.status }).from(backups).orderBy(desc(backups.startedAt)).limit(1);
  // After a failure, retry at most hourly.
  if (last?.status === "failed") return Date.now() - last.at.getTime() > 3600_000;
  if (last?.status === "running" && Date.now() - last.at.getTime() < 3600_000) return false;
  const [ok] = await db.select({ at: backups.startedAt }).from(backups).where(eq(backups.status, "ok")).orderBy(desc(backups.startedAt)).limit(1);
  return !ok || Date.now() - ok.at.getTime() > hours * 3600_000;
}

export function parseBackup(file: Buffer): { header: { tables: string[]; createdAt: string }; rows: Map<string, Record<string, unknown>[]> } {
  const text = gunzipSync(decryptBackup(file)).toString("utf8");
  const [head, ...rest] = text.split("\n");
  const header = JSON.parse(head);
  if (header.format !== "movevitals-backup") throw new Error("unknown backup format");
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const line of rest) {
    if (!line) continue;
    const { t, r } = JSON.parse(line);
    if (!rows.has(t)) rows.set(t, []);
    rows.get(t)!.push(r);
  }
  return { header, rows };
}
