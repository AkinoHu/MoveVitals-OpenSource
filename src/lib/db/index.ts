import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

// Production uses Postgres via DATABASE_URL. Without it (local development),
// we fall back to an embedded PGlite database stored in ./.data/pglite so the
// app runs with zero setup.
const g = globalThis as unknown as { __mvDb?: Db; __mvClient?: postgres.Sql; __mvDbReady?: Promise<void> };

// Arbitrary constant: the advisory-lock key that serialises migrations between
// the web and worker processes.
const MIGRATION_LOCK_KEY = 7_361_904_221;

export function dbKind(): "postgres" | "pglite" {
  return process.env.DATABASE_URL ? "postgres" : "pglite";
}

function create(): Db {
  if (process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
    g.__mvClient = client;
    return drizzlePg(client, { schema });
  }
  // Loaded lazily so production bundles never touch PGlite.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dir, { recursive: true });
  return drizzle(new PGlite(dir), { schema }) as unknown as Db;
}

// Created on first use so builds and imports never open a connection.
export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    const real = g.__mvDb ?? (g.__mvDb = create());
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

function realDb(): Db {
  return g.__mvDb ?? (g.__mvDb = create());
}

export async function migrate(): Promise<void> {
  if (!g.__mvDbReady) {
    g.__mvDbReady = (async () => {
      const migrationsFolder = path.join(process.cwd(), "drizzle");
      if (dbKind() === "postgres") {
        const { migrate: m } = await import("drizzle-orm/postgres-js/migrator");
        const db = realDb();
        // Web and worker both migrate on boot; a session-level advisory lock on
        // a reserved connection makes the second one wait, then find nothing to do.
        const lock = await g.__mvClient!.reserve();
        try {
          await lock`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
          await m(db, { migrationsFolder });
        } finally {
          await lock`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => undefined);
          lock.release();
        }
      } else {
        const { migrate: m } = await import("drizzle-orm/pglite/migrator");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await m(realDb() as any, { migrationsFolder });
      }
    })().catch((e) => {
      g.__mvDbReady = undefined;
      throw e;
    });
  }
  return g.__mvDbReady;
}

export { schema };
