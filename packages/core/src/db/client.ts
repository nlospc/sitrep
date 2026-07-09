import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolves alongside whichever of src/ or dist/ this module is running from —
// packages/core/scripts/copy-migrations.mjs copies src/db/migrations into
// dist/db/migrations as a build step so the compiled package is self-contained.
const MIGRATIONS_FOLDER = path.join(here, "migrations");

/** Opens (creating if absent) a SQLite file at `dbPath` and applies pending migrations. */
export function createDb(dbPath: string): Db {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** In-memory DB for tests: same schema, no file, no persistence across process exit. */
export function createInMemoryDb(): Db {
  return createDb(":memory:");
}

export { schema };
