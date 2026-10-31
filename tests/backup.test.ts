import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { makeUser, setupDb } from "./helpers";

describe("backups", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mv-bk-"));
  let userId = "";
  before(async () => {
    await setupDb();
    process.env.BACKUP_DIR = dir;
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const { db } = await import("../src/lib/db");
    const { activities, activityGroups } = await import("../src/lib/db/schema");
    const u = await makeUser();
    userId = u.id;
    const t = new Date("2026-01-01T10:00:00Z");
    const [g] = await db.insert(activityGroups).values({ userId, sport: "run", startTime: t, endTime: new Date(t.getTime() + 3600_000) }).returning();
    const [a] = await db.insert(activities).values({ userId, provider: "garmin", externalId: "x1", sport: "run", startTime: t, endTime: new Date(t.getTime() + 3600_000), groupId: g.id }).returning();
    await db.update(activityGroups).set({ primaryActivityId: a.id }).where((await import("drizzle-orm")).eq(activityGroups.id, g.id));
  });

  it("streams an encrypted backup that parses back with all rows", async () => {
    const { runBackup, parseBackup } = await import("../src/lib/backup");
    const r = await runBackup();
    assert.equal(r.ok, true, r.error);
    const files = readdirSync(dir).filter((f) => f.endsWith(".mvbk"));
    assert.equal(files.length, 1);
    assert.equal(readdirSync(dir).filter((f) => f.endsWith(".partial")).length, 0);
    const raw = readFileSync(path.join(dir, files[0]));
    assert.ok(!raw.includes(Buffer.from("garmin")), "ciphertext must not contain plaintext");
    const { rows } = parseBackup(raw);
    assert.equal(rows.get("users")?.some((x) => x.id === userId), true);
    assert.equal(rows.get("activities")?.length, 1);
    assert.equal(rows.get("activity_groups")?.length, 1);
    // tampering and a wrong key are both detected
    const bad = Buffer.from(raw);
    bad[bad.length - 40] ^= 1;
    assert.throws(() => parseBackup(bad));
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    assert.throws(() => parseBackup(raw));
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  });

  it("refuses a second concurrent backup", async () => {
    const { acquireLease, releaseLease } = await import("../src/lib/locks");
    const { runBackup } = await import("../src/lib/backup");
    const owner = (await acquireLease("backup", 60_000))!;
    assert.deepEqual(await runBackup(), { id: "", ok: false, error: "already_running" });
    await releaseLease("backup", owner);
  });

  it("restores into an empty database, including circular activity <-> group links", () => {
    const file = path.join(dir, readdirSync(dir).find((f) => f.endsWith(".mvbk"))!);
    const env = { ...process.env, PGLITE_DIR: mkdtempSync(path.join(tmpdir(), "mv-restore-")), DATABASE_URL: "" };
    const run = spawnSync("npx", ["tsx", "scripts/restore-backup.ts", file, "--yes"], { env, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const check = spawnSync(
      "npx",
      ["tsx", "-e", `import {db} from "./src/lib/db"; import {activityGroups, activities} from "./src/lib/db/schema"; (async()=>{const g=await db.select().from(activityGroups); const a=await db.select().from(activities); console.log(JSON.stringify({g:g.length,a:a.length,link:g[0]?.primaryActivityId===a[0]?.id && a[0]?.groupId===g[0]?.id}));process.exit(0)})()`],
      { env, encoding: "utf8" },
    );
    assert.match(check.stdout, /"g":1,"a":1,"link":true/, check.stdout + check.stderr);
  });
});
