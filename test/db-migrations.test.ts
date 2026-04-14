import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/server/db/migrate.ts";

describe("runMigrations", () => {
  test("creates schema and is idempotent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "orchd-db-"));
    const dbPath = path.join(root, "orchd.sqlite");
    const db = new Database(dbPath, { create: true });

    runMigrations(db, path.resolve(process.cwd(), "src/server/db/migrations"));
    runMigrations(db, path.resolve(process.cwd(), "src/server/db/migrations"));

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual([
      "auth_sessions",
      "projects",
      "schema_migrations",
      "sessions",
      "terminal_sessions",
    ]);

    const migrations = db.query("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number };
    expect(migrations.count).toBe(1);
  });
});
