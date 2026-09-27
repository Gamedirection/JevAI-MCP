import { z } from "zod";

export const requestStorageModeSchema = z.enum(["off", "metadata_only", "full"]);
export type RequestStorageMode = z.infer<typeof requestStorageModeSchema>;

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const timeRangePresetSchema = z.enum(["today", "7d", "30d", "month", "year", "custom"]);
export type TimeRangePreset = z.infer<typeof timeRangePresetSchema>;

export const settingsSchema = z.object({
   jev: z.object({
      endpoint: z.string().url(),
      model: z.string().min(1),
      timeoutMs: z.number().int().min(50).max(120_000),
      retries: z.number().int().min(0).max(10),
      retryBaseDelayMs: z.number().int().min(1).max(10_000),
      retryMaxDelayMs: z.number().int().min(2).max(60_000),
   }),
   mcp: z.object({
      enabled: z.boolean(),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65_535),
   }),
   storage: z.object({
      retentionDays: z.number().int().min(0),
      requestState: requestStorageModeSchema,
      storeResponses: z.boolean(),
   }),
   logging: z.object({
      level: logLevelSchema,
      retentionDays: z.number().int().min(1).max(3650),
      maxFileBytes: z.number().int().min(100_000).max(500_000_000),
   }),
   metrics: z.object({
      tokenSavingsEnabled: z.boolean(),
      estimatedAvoidedTokens: z.number().int().min(0).max(1_000_000),
   }),
   ui: z.object({
      defaultTimeRange: timeRangePresetSchema,
      refreshIntervalSeconds: z.number().int().min(0).max(3600),
   }),
   integration: z.object({
      publicProtocol: z.enum(["http", "https"]),
      publicHostname: z.string().min(1),
      publicPort: z.number().int().min(1).max(65_535),
   }),
});

export type AppSettings = z.infer<typeof settingsSchema>;

export type ApiKeySource = "environment" | "database" | "none";

export interface EffectiveSettings {
   settings: AppSettings;
   apiKeySource: ApiKeySource;
   apiKeyAvailable: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
   jev: {
      endpoint: "https://api.defapi.org/v1",
      model: "typesafe/jev-1.13",
      timeoutMs: 10_000,
      retries: 3,
      retryBaseDelayMs: 300,
      retryMaxDelayMs: 5_000,
   },
   mcp: {
      enabled: true,
      host: "0.0.0.0",
      port: 3001,
   },
   storage: {
      retentionDays: 365,
      requestState: "metadata_only",
      storeResponses: true,
   },
   logging: {
      level: "info",
      retentionDays: 14,
      maxFileBytes: 10_000_000,
   },
   metrics: {
      tokenSavingsEnabled: true,
      estimatedAvoidedTokens: 1_500,
   },
   ui: {
      defaultTimeRange: "7d",
      refreshIntervalSeconds: 30,
   },
   integration: {
      publicProtocol: "http",
      publicHostname: "localhost",
      publicPort: 3001,
   },
};

export const envInt = (value: string | undefined, fallback: number): number => {
   if (value === undefined || value.trim() === "") return fallback;
   const parsed = Number.parseInt(value, 10);
   return Number.isFinite(parsed) ? parsed : fallback;
};

export const envBool = (value: string | undefined, fallback: boolean): boolean => {
   if (value === undefined || value.trim() === "") return fallback;
   const normalized = value.trim().toLowerCase();
   if (["1", "true", "yes", "on"].includes(normalized)) return true;
   if (["0", "false", "no", "off"].includes(normalized)) return false;
   return fallback;
};

export interface EnvOverridesInput {
   DEFAPI_API_ENDPOINT?: string;
   JEV_API_ENDPOINT?: string;
   JEV_MODEL?: string;
   /**
    * Backup credentials. A key is only valid at the endpoint that issued it,
    * so each backup brings its own endpoint and model. Numbered 2 and 3 so the
    * primary stays first.
    */
   JEV_BACKUP_2_ENDPOINT?: string;
   JEV_BACKUP_2_MODEL?: string;
   JEV_BACKUP_2_API_KEY?: string;
   JEV_BACKUP_3_ENDPOINT?: string;
   JEV_BACKUP_3_MODEL?: string;
   JEV_BACKUP_3_API_KEY?: string;
   JEV_TIMEOUT_MS?: string;
   JEV_RETRIES?: string;
   JEV_RETRY_BASE_DELAY_MS?: string;
   JEV_RETRY_MAX_DELAY_MS?: string;
   MCP_ENABLED?: string;
   MCP_HOST?: string;
   MCP_PORT?: string;
   PORT?: string;
   DATABASE_PATH?: string;
   LOG_LEVEL?: string;
   DATA_RETENTION_DAYS?: string;
   LOG_RETENTION_DAYS?: string;
   LOG_MAX_FILE_BYTES?: string;
   REQUEST_STATE_STORAGE?: string;
   STORE_JEV_RESPONSES?: string;
   TOKEN_SAVINGS_ENABLED?: string;
   ESTIMATED_AVOIDED_TOKENS?: string;
   DEFAULT_TIME_RANGE?: string;
   REFRESH_INTERVAL_SECONDS?: string;
   PUBLIC_PROTOCOL?: string;
   PUBLIC_HOSTNAME?: string;
   PUBLIC_MCP_PORT?: string;
}

export function applyEnvOverrides(
   base: AppSettings,
   env: EnvOverridesInput,
): AppSettings {
   return {
      jev: {
         endpoint: env.DEFAPI_API_ENDPOINT ?? env.JEV_API_ENDPOINT ?? base.jev.endpoint,
         model: env.JEV_MODEL ?? base.jev.model,
         timeoutMs: envInt(env.JEV_TIMEOUT_MS, base.jev.timeoutMs),
         retries: envInt(env.JEV_RETRIES, base.jev.retries),
         retryBaseDelayMs: envInt(env.JEV_RETRY_BASE_DELAY_MS, base.jev.retryBaseDelayMs),
         retryMaxDelayMs: envInt(env.JEV_RETRY_MAX_DELAY_MS, base.jev.retryMaxDelayMs),
      },
      mcp: {
         enabled: envBool(env.MCP_ENABLED, base.mcp.enabled),
         host: env.MCP_HOST ?? base.mcp.host,
         port: envInt(env.MCP_PORT, base.mcp.port),
      },
      storage: {
         retentionDays: envInt(env.DATA_RETENTION_DAYS, base.storage.retentionDays),
         requestState: isStorageMode(env.REQUEST_STATE_STORAGE)
            ? env.REQUEST_STATE_STORAGE
            : base.storage.requestState,
         storeResponses: envBool(env.STORE_JEV_RESPONSES, base.storage.storeResponses),
      },
      logging: {
         level: isLogLevel(env.LOG_LEVEL) ? env.LOG_LEVEL : base.logging.level,
         retentionDays: envInt(env.LOG_RETENTION_DAYS, base.logging.retentionDays),
         maxFileBytes: envInt(env.LOG_MAX_FILE_BYTES, base.logging.maxFileBytes),
      },
      metrics: {
         tokenSavingsEnabled: envBool(env.TOKEN_SAVINGS_ENABLED, base.metrics.tokenSavingsEnabled),
         estimatedAvoidedTokens: envInt(
            env.ESTIMATED_AVOIDED_TOKENS,
            base.metrics.estimatedAvoidedTokens,
         ),
      },
      ui: {
         defaultTimeRange: isTimeRange(env.DEFAULT_TIME_RANGE)
            ? env.DEFAULT_TIME_RANGE
            : base.ui.defaultTimeRange,
         refreshIntervalSeconds: envInt(
            env.REFRESH_INTERVAL_SECONDS,
            base.ui.refreshIntervalSeconds,
         ),
      },
      integration: {
         publicProtocol:
            env.PUBLIC_PROTOCOL === "https" || env.PUBLIC_PROTOCOL === "http"
               ? env.PUBLIC_PROTOCOL
               : base.integration.publicProtocol,
         publicHostname: env.PUBLIC_HOSTNAME ?? base.integration.publicHostname,
         publicPort: envInt(env.PUBLIC_MCP_PORT ?? env.MCP_PORT, base.integration.publicPort),
      },
   };
}

function isStorageMode(value: string | undefined): value is RequestStorageMode {
   return value === "off" || value === "metadata_only" || value === "full";
}

function isLogLevel(value: string | undefined): value is LogLevel {
   return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function isTimeRange(value: string | undefined): value is TimeRangePreset {
   return (
      value === "today" ||
      value === "7d" ||
      value === "30d" ||
      value === "month" ||
      value === "year" ||
      value === "custom"
   );
}

export function mcpUrlFromSettings(settings: AppSettings): string {
   const { publicProtocol, publicHostname, publicPort } = settings.integration;
   const hostname = publicHostname.includes(":")
      ? `[${publicHostname}]`
      : publicHostname;
   return `${publicProtocol}://${hostname}:${publicPort}`;
}
