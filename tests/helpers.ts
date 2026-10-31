// Test bootstrap: an isolated embedded Postgres (PGlite) with every migration
// applied. Import this module BEFORE anything from src/lib/db.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = mkdtempSync(path.join(tmpdir(), "mv-test-"));
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.APP_URL ||= "http://localhost:3000";

export async function setupDb() {
  const { migrate, db } = await import("../src/lib/db");
  await migrate();
  return db;
}

export async function makeUser(email = `u${Math.random().toString(36).slice(2)}@example.com`) {
  const { db } = await import("../src/lib/db");
  const { users } = await import("../src/lib/db/schema");
  const [u] = await db.insert(users).values({ email }).returning();
  return u;
}
