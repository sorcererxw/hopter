import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Database } from "bun:sqlite";

export function runMigrations(db: Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .query("SELECT id FROM schema_migrations ORDER BY id")
      .all()
      .map((row) => (row as { id: string }).id),
  );

  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migrationFile of migrationFiles) {
    if (applied.has(migrationFile)) {
      continue;
    }

    const sql = readFileSync(path.join(migrationsDir, migrationFile), "utf8");
    const now = new Date().toISOString();

    db.transaction(() => {
      db.exec(sql);
      db
        .query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(migrationFile, now);
    })();
  }
}
