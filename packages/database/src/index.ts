import type { AppSettings } from "@jevai/shared";
import { openDatabase, isHealthy, type SqliteDb } from "./db.ts";
import {
   ConnectionEventRepository,
   LogRepository,
   RequestRepository,
   SettingsRepository,
   type LogFilters,
   type LogFilters as LogFilterInput,
   type NewLogRecord,
   type NewRequestRecord,
   type RequestFilters,
} from "./repositories.ts";
import { SqliteApiKeyStore, maskApiKey, type ApiKeyStore, type StoredApiKey } from "./api-key-store.ts";

export interface DatabaseStats {
   requests: { total: number; byStatus: Array<{ status: string; count: number }> };
   logs: { total: number; byLevel: Array<{ level: string; count: number }> };
   fileSizeBytes: number | null;
   applicationIdVersion: number | null;
   schemaVersion: number | null;
   databaseHealthy: boolean;
   }

export class Database {
   readonly db: SqliteDb;
   readonly requests: RequestRepository;
   readonly logs: LogRepository;
   readonly connectionEvents: ConnectionEventRepository;
   readonly settings: SettingsRepository;
   readonly apiKeys: ApiKeyStore;
   readonly path: string;

   constructor(databasePath: string) {
      this.path = databasePath;
      this.db = openDatabase(databasePath);
      this.requests = new RequestRepository(this.db);
      this.logs = new LogRepository(this.db);
      this.connectionEvents = new ConnectionEventRepository(this.db);
      this.settings = new SettingsRepository(this.db);
      if (databasePath === ":memory:") {
         this.apiKeys = new InMemoryApiKeyStore();
             } else {
         this.apiKeys = new SqliteApiKeyStore(this.db);
             }
   }

   healthy(): boolean {
      return isHealthy(this.db);
       }

   retentionDate(retentionDays: number, now = new Date()): string | null {
      if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
      return new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
       }

   applyRetention(settings: AppSettings, now = new Date()): RetentionResult {
      const result: RetentionResult = { requestsDeleted: 0, logsDeleted: 0, connectionEventsDeleted: 0 };
      const requestCutoff = this.retentionDate(settings.storage.retentionDays, now);
      if (requestCutoff) result.requestsDeleted = this.requests.purgeOlderThan(requestCutoff);
      const logCutoff = this.retentionDate(settings.logging.retentionDays, now);
      if (logCutoff) result.logsDeleted = this.logs.purgeOlderThan(logCutoff);
      const connectionCutoff = this.retentionDate(settings.storage.retentionDays, now);
      if (connectionCutoff) {
         result.connectionEventsDeleted = this.connectionEvents.purgeOlderThan(connectionCutoff);
             }
      return result;
       }

   stats(fileSizeBytes: number | null): DatabaseStats {
      const schemaVersion = this.db
           .prepare("SELECT MAX(version) AS version FROM schema_migrations")
           .get() as { version: number | null };
      return {
         requests: this.requests.counts(),
         logs: this.logs.counts(),
         fileSizeBytes,
         applicationIdVersion: null,
         schemaVersion: schemaVersion.version,
         databaseHealthy: this.healthy(),
             };
       }

   close(): void {
      try {
         this.db.close();
             } catch {
             }
       }
}

export interface RetentionResult {
   requestsDeleted: number;
   logsDeleted: number;
   connectionEventsDeleted: number;
}

class InMemoryApiKeyStore implements ApiKeyStore {
   private stored: { value: string; createdAt: string; updatedAt: string } | undefined;

   save(apiKey: string): void {
      const now = new Date().toISOString();
      this.stored = { value: apiKey.trim(), createdAt: this.stored?.createdAt ?? now, updatedAt: now };
   }
   get(): string | undefined { return this.stored?.value; }
   clear(): void { this.stored = undefined; }
   info(): StoredApiKey | undefined {
      if (!this.stored) return undefined;
      return {
         masked: maskApiKey(this.stored.value),
         createdAt: this.stored.createdAt,
         updatedAt: this.stored.updatedAt,
             };
          }
}

export type { LogFilters, LogFilterInput, NewLogRecord, NewRequestRecord, RequestFilters };
export * from "./repositories.ts";
export * from "./db.ts";
export * from "./api-key-store.ts";
