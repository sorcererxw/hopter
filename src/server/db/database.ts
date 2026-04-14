import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { AppConfig } from "../config/types.ts";
import { runMigrations } from "./migrate.ts";

export function openDatabase(config: Pick<AppConfig, "storage">): Database {
  mkdirSync(path.dirname(config.storage.dbPath), { recursive: true });
  const db = new Database(config.storage.dbPath, { create: true });
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db, path.resolve(process.cwd(), "src/server/db/migrations"));
  return db;
}
