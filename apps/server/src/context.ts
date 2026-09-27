import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
   DEFAULT_SETTINGS,
   applyEnvOverrides,
   settingsSchema,
   type ApiKeySource,
   type AppSettings,
   type EnvOverridesInput,
   type LogComponent,
   type LogLevel,
} from "@jevai/shared";
import { Database } from "@jevai/database";
import { JevClient, type JevConnectionStatus } from "@jevai/jev-client";
import { createLoggerFactory, type LoggerFactory } from "./logger.ts";
import { createMetrics, type JevaiMetrics } from "./metrics.ts";
import { version } from "./version.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface ProcessEnv extends EnvOverridesInput {
   DEFAPI_API_KEY?: string;
   NODE_ENV?: string;
   WEB_DIR?: string;
}

interface EnvBackupSlot {
   label: string;
   endpoint: string | undefined;
   model: string | undefined;
   apiKey: string | undefined;
}

/** Numbered backup slots, in the order the client should try them. */
const BACKUP_SLOTS: Array<{ slot: string; label: string }> = [
   { slot: "2", label: "backup-2" },
   { slot: "3", label: "backup-3" },
];

const FAILURE_STATES = new Set<JevConnectionStatus["state"]>([
   "disconnected",
   "timeout",
   "auth_failure",
   "rate_limited",
]);

export class SettingsValidationError extends Error {
   readonly issues: string[];
   constructor(issues: string[]) {
      super(`Invalid settings: ${issues.join("; ")}`);
      this.name = "SettingsValidationError";
      this.issues = issues;
         }
}

export class AppContext {
   readonly db: Database;
   readonly logs: LoggerFactory;
   readonly metrics: JevaiMetrics;
   readonly client: JevClient;
   readonly startedAt = new Date();
   readonly versionInfo = version;
   private settings: AppSettings;
   private readonly envKey: string | undefined;
   private readonly env: ProcessEnv;
   private lastKnownState: JevConnectionStatus["state"] = "unknown";
   private readonly backups: EnvBackupSlot[];

   private constructor(env: ProcessEnv, dbPath: string) {
      this.env = env;
      this.envKey = env.DEFAPI_API_KEY?.trim() || undefined;
      this.settings = applyEnvOverrides(DEFAULT_SETTINGS, env);
      this.backups = BACKUP_SLOTS.map(({ slot, label }) => ({
         label,
         endpoint: env[`JEV_BACKUP_${slot}_ENDPOINT`]?.trim() || undefined,
         model: env[`JEV_BACKUP_${slot}_MODEL`]?.trim() || undefined,
         apiKey: env[`JEV_BACKUP_${slot}_API_KEY`]?.trim() || undefined,
            })).filter((backup) => backup.apiKey !== undefined);

      this.db = new Database(dbPath);
      this.logs = createLoggerFactory(this.settings.logging.level, this.db.logs);
      this.metrics = createMetrics(version.version);

      this.client = new JevClient({
         endpoint: this.settings.jev.endpoint,
         model: this.settings.jev.model,
         getApiKey: () => this.getApiKey(),
         backupCredentials: this.backups.map((backup) => ({
            label: backup.label,
            endpoint: backup.endpoint ?? this.settings.jev.endpoint,
            model: backup.model ?? this.settings.jev.model,
            getApiKey: () => backup.apiKey,
               })),
         timeoutMs: this.settings.jev.timeoutMs,
         retries: this.settings.jev.retries,
         retryBaseDelayMs: this.settings.jev.retryBaseDelayMs,
         retryMaxDelayMs: this.settings.jev.retryMaxDelayMs,
         logger: this.logs.get("jev"),
          });

      this.client.onConnectionChange((previous, current) => this.onConnectionChange(previous, current));
   }

   static create(env: ProcessEnv = process.env as ProcessEnv): AppContext {
      const dbPath = env.DATABASE_PATH ?? "./data/jevai.db";
      return new AppContext(env, dbPath);
   }

   private onConnectionChange(
      previous: JevConnectionStatus,
      current: JevConnectionStatus,
   ): void {
      if (previous.state === current.state) return;
      try {
         if (this.lastKnownState !== "unknown" && FAILURE_STATES.has(current.state)) {
               this.db.connectionEvents.insert(
                  current.state,
                  current.lastFailureReason,
                  current.lastFailureStatus,
                   );
               this.metrics.disconnectsTotal.inc(1, { type: current.state });
               this.metrics.jevUpstream.set(0);
               this.logs.get("system").warn("DefAPI connection lost", {
                  state: current.state,
                  reason: current.lastFailureReason,
                  status: current.lastFailureStatus,
                   });
               } else if (FAILURE_STATES.has(previous.state) && current.state === "connected") {
               this.db.connectionEvents.insert("recovered", null, null);
               this.metrics.jevUpstream.set(1);
               this.logs.get("system").info("DefAPI connection recovered");
               } else if (current.state === "connected") {
               this.metrics.jevUpstream.set(1);
               }
         this.lastKnownState = current.state;
            } catch {
         // connection bookkeeping must never break requests
            }
   }

   getSettings(): AppSettings {
      return this.settings;
   }

   apiKeySource(): ApiKeySource {
      if (this.envKey) return "environment";
      if (this.db.apiKeys.get()) return "database";
      return "none";
       }

   envHasKey(): boolean {
      return this.envKey !== undefined;
        }

   /** Labels of the configured backup credentials, for status and logs. */
   backupLabels(): string[] {
      return this.backups.map((backup) => backup.label);
        }

   getApiKey(): string | undefined {
      return this.envKey ?? this.db.apiKeys.get();
   }

   saveApiKey(apiKey: string): void {
      this.db.apiKeys.save(apiKey);
   }

   clearApiKey(): void {
      this.db.apiKeys.clear();
   }

   updateSettings(next: AppSettings): void {
      const parsed = settingsSchema.safeParse(next);
      if (!parsed.success) {
            throw new SettingsValidationError(
                  parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
                     );
                 }
      this.settings = parsed.data;
      this.db.settings.set("app.settings", parsed.data);
      this.client.updateOptions({
         endpoint: parsed.data.jev.endpoint,
         model: parsed.data.jev.model,
         timeoutMs: parsed.data.jev.timeoutMs,
         retries: parsed.data.jev.retries,
         retryBaseDelayMs: parsed.data.jev.retryBaseDelayMs,
         retryMaxDelayMs: parsed.data.jev.retryMaxDelayMs,
              });
      this.logs.setLevel(parsed.data.logging.level);
        }

   loadPersistedSettings(): void {
      const stored = this.db.settings.get<unknown>("app.settings");
      const parsed = settingsSchema.safeParse(stored);
      if (parsed.success) {
            const merged = applyEnvOverrides(parsed.data, this.env);
            const validated = settingsSchema.safeParse(merged);
            this.settings = validated.success ? validated.data : parsed.data;
            this.client.updateOptions({
                  endpoint: this.settings.jev.endpoint,
                  model: this.settings.jev.model,
                  timeoutMs: this.settings.jev.timeoutMs,
                  retries: this.settings.jev.retries,
                  retryBaseDelayMs: this.settings.jev.retryBaseDelayMs,
                  retryMaxDelayMs: this.settings.jev.retryMaxDelayMs,
                        });
            this.logs.setLevel(this.settings.logging.level);
                 }
        }

   log(component: LogComponent) {
      return this.logs.get(component);
   }

   logLevel(): LogLevel {
      return this.logs.get("system").getLevel();
   }

   resolveWebDir(): string | undefined {
      if (this.env.WEB_DIR && existsDir(this.env.WEB_DIR)) return this.env.WEB_DIR;
      const candidates = [
         path.resolve(HERE, "../../web/dist"),
         path.resolve(HERE, "../../../apps/web/dist"),
         path.resolve(process.cwd(), "apps/web/dist"),
         path.resolve(process.cwd(), "web/dist"),
            ];
      return candidates.find((candidate) => existsDir(candidate));
   }

   databaseFileSizeBytes(): number | null {
      if (this.db.path === ":memory:") return null;
      try {
         return statSync(this.db.path).size;
            } catch {
         return null;
            }
   }

   close(): void {
      this.logs.close();
      this.db.close();
   }
}

function existsDir(candidate: string): boolean {
   try {
      return existsSync(candidate) && statSync(candidate).isDirectory();
         } catch {
      return false;
         }
}

export { DEFAULT_SETTINGS };
