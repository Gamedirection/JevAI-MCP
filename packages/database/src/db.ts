import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

export type SqliteDb = Database.Database;

export interface Migration {
   version: number;
   name: string;
   up: string;
}

export const MIGRATIONS: Migration[] = [
    {
      version: 1,
      name: "initial",
      up: `
        CREATE TABLE requests (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           request_id TEXT NOT NULL,
           timestamp TEXT NOT NULL,
           caller TEXT NOT NULL,
           tool TEXT NOT NULL,
           model TEXT,
           duration_ms INTEGER NOT NULL,
           input_tokens INTEGER,
           output_tokens INTEGER,
           status TEXT NOT NULL CHECK (status IN ('success', 'error')),
           error_category TEXT,
           error_message TEXT,
           client_version TEXT,
           project TEXT,
           repository TEXT,
           session_id TEXT,
           question_count INTEGER,
           state_size_chars INTEGER,
           state_json TEXT,
           response_json TEXT
        );
        CREATE INDEX idx_requests_timestamp ON requests (timestamp);
        CREATE INDEX idx_requests_caller ON requests (caller);
        CREATE INDEX idx_requests_tool ON requests (tool);
        CREATE INDEX idx_requests_status ON requests (status);
        CREATE INDEX idx_requests_request_id ON requests (request_id);

        CREATE TABLE logs (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           timestamp TEXT NOT NULL,
           level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
           component TEXT NOT NULL,
           message TEXT NOT NULL,
           context TEXT
        );
        CREATE INDEX idx_logs_timestamp ON logs (timestamp);
        CREATE INDEX idx_logs_level ON logs (level);
        CREATE INDEX idx_logs_component ON logs (component);

        CREATE TABLE connection_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           timestamp TEXT NOT NULL,
           state TEXT NOT NULL,
           reason TEXT,
           status_code INTEGER
        );
        CREATE INDEX idx_connection_events_timestamp ON connection_events (timestamp);

        CREATE TABLE settings (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL,
           updated_at TEXT NOT NULL
        );
      `,
    },
];

export function openDatabase(databasePath: string): SqliteDb {
   if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
      }
   const db = new Database(databasePath);
   db.pragma("journal_mode = WAL");
   db.pragma("synchronous = NORMAL");
   db.pragma("foreign_keys = ON");
   runMigrations(db);
   return db;
}

export function runMigrations(db: SqliteDb): number[] {
   db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (" +
         "version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
   const appliedRows = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
   const appliedVersions = new Set(appliedRows.map((row) => row.version));
   const appliedNow: number[] = [];

   for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;
      db.exec("BEGIN");
      try {
         db.exec(migration.up);
         db.prepare(
               "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
              ).run(migration.version, new Date().toISOString());
         db.exec("COMMIT");
             } catch (error) {
         db.exec("ROLLBACK");
         throw new Error(
               `Migration ${migration.version} (${migration.name}) failed: ${
                   error instanceof Error ? error.message : String(error)
                   }`,
               );
             }
      appliedNow.push(migration.version);
       }
   return appliedNow;
   }

export function isHealthy(db: SqliteDb): boolean {
   try {
      db.prepare("SELECT 1 AS ok").get();
      return true;
       } catch {
      return false;
       }
}
