import { Hono } from "hono";
import {
   DEFAULT_SETTINGS,
   mcpUrlFromSettings,
   settingsSchema,
   type AppSettings,
   type ApiKeySource,
} from "@jevai/shared";
import type { AppContext } from "../context.ts";
import { app, errorResponse, json } from "./common.ts";

export interface RedactedSettings {
   settings: AppSettings;
   apiKeySource: ApiKeySource;
   apiKeyMasked: string | null;
   mcpUrl: string;
   defaults: AppSettings;
   envOverrideKeys: string[];
}

const ENV_KEY_VARS: Array<{ key: keyof AppSettings | string; env: string }> = [
    { key: "jev.endpoint", env: "DEFAPI_API_ENDPOINT" },
    { key: "jev.model", env: "JEV_MODEL" },
    { key: "jev.timeoutMs", env: "JEV_TIMEOUT_MS" },
    { key: "jev.retries", env: "JEV_RETRIES" },
    { key: "mcp.enabled", env: "MCP_ENABLED" },
    { key: "mcp.host", env: "MCP_HOST" },
    { key: "mcp.port", env: "MCP_PORT" },
    { key: "storage.retentionDays", env: "DATA_RETENTION_DAYS" },
    { key: "storage.requestState", env: "REQUEST_STATE_STORAGE" },
    { key: "storage.storeResponses", env: "STORE_JEV_RESPONSES" },
    { key: "logging.level", env: "LOG_LEVEL" },
    { key: "metrics.tokenSavingsEnabled", env: "TOKEN_SAVINGS_ENABLED" },
    { key: "metrics.estimatedAvoidedTokens", env: "ESTIMATED_AVOIDED_TOKENS" },
    { key: "integration.publicHostname", env: "PUBLIC_HOSTNAME" },
    { key: "integration.publicProtocol", env: "PUBLIC_PROTOCOL" },
    { key: "integration.publicPort", env: "PUBLIC_MCP_PORT" },
];

export function settingsRoutes(): Hono<{ Variables: { app: AppContext } }> {
   const routes = new Hono<{ Variables: { app: AppContext } }>();

   routes.get("/settings", (c) => {
      const application = app(c);
      return json(c, { success: true, data: redactedSettings(application) });
          });

   routes.put("/settings", async (c) => {
      const application = app(c);
      let body: unknown;
      try {
            body = await c.req.json();
                } catch {
         return errorResponse(c, 400, "Body must be valid JSON");
                }
      const incoming = (body as { settings?: unknown })?.settings ?? body;
      const parsed = settingsSchema.safeParse(mergeSettings(application.getSettings(), incoming));
      if (!parsed.success) {
            return errorResponse(c, 422, "Invalid settings", parsed.error.issues.slice(0, 8));
                }
      application.updateSettings(parsed.data);
      application.log("api").info("settings updated");
      return json(c, { success: true, data: redactedSettings(application) });
           });

   routes.post("/settings/api-key", async (c) => {
      const application = app(c);
      let body: { apiKey?: unknown };
      try {
            body = (await c.req.json()) as { apiKey?: unknown };
                } catch {
         return errorResponse(c, 400, "Body must be valid JSON");
                }
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (apiKey.length < 8) {
            return errorResponse(c, 422, "API key looks too short. Expected a DefAPI key (dk-...).");
                }
      if (application.apiKeySource() === "environment") {
            return errorResponse(
                  c,
                  409,
                  "An API key is already provided through the DEFAPI_API_KEY environment variable. Remove it to store a key in the application.",
                     );
                }
      application.saveApiKey(apiKey);
      application.log("api").info("API key saved through settings");
      return json(c, { success: true, data: redactedSettings(application) });
           });

   routes.delete("/settings/api-key", (c) => {
      const application = app(c);
      if (application.apiKeySource() === "environment") {
            return errorResponse(c, 409, "The environment variable API key cannot be deleted here.");
                }
      application.clearApiKey();
      application.log("api").info("stored API key removed");
      return json(c, { success: true, data: redactedSettings(application) });
           });

   routes.post("/settings/reset", (c) => {
      const application = app(c);
      application.updateSettings(DEFAULT_SETTINGS);
      application.log("api").info("settings reset to defaults");
      return json(c, { success: true, data: redactedSettings(application) });
           });

   return routes;
}

function mergeSettings(current: AppSettings, incoming: unknown): AppSettings {
   if (!incoming || typeof incoming !== "object") return current;
   const patch = incoming as {
      jev?: Partial<AppSettings["jev"]>;
      mcp?: Partial<AppSettings["mcp"]>;
      storage?: Partial<AppSettings["storage"]>;
      logging?: Partial<AppSettings["logging"]>;
      metrics?: Partial<AppSettings["metrics"]>;
      ui?: Partial<AppSettings["ui"]>;
      integration?: Partial<AppSettings["integration"]>;
   };
   return {
      jev: { ...current.jev, ...patch.jev },
      mcp: { ...current.mcp, ...patch.mcp },
      storage: { ...current.storage, ...patch.storage },
      logging: { ...current.logging, ...patch.logging },
      metrics: { ...current.metrics, ...patch.metrics },
      ui: { ...current.ui, ...patch.ui },
      integration: { ...current.integration, ...patch.integration },
         };
}

export function redactedSettings(application: AppContext): RedactedSettings {
   const settings = application.getSettings();
   const source = application.apiKeySource();
   const storedInfo = application.db.apiKeys.info();
   const envKeyPresent = application.envHasKey();
   return {
      settings,
      apiKeySource: source,
      apiKeyMasked: envKeyPresent
            ? "dk-****************************(env)"
               : storedInfo?.masked ?? null,
      mcpUrl: mcpUrlFromSettings(settings),
      defaults: DEFAULT_SETTINGS,
      envOverrideKeys: ENV_KEY_VARS.filter((entry) => entryIsOverridden(entry.env)).map(
            (entry) => entry.key as string,
               ),
         };
}

function entryIsOverridden(envName: string): boolean {
   const value = process.env[envName];
   return value !== undefined && value.trim() !== "";
}
