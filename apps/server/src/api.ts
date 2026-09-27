import { Hono } from "hono";
import type { Context, Next } from "hono";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
   DEFAULT_CONFIDENCE_THRESHOLDS,
   mcpUrlFromSettings,
   redactText,
} from "@jevai/shared";
import type { AppContext } from "./context.ts";
import { buildFallbackDeps } from "./fallback.ts";
import { app as getApp, json } from "./routes/common.ts";
import { dashboardRoutes, activeClientsCount } from "./routes/dashboard.ts";
import { requestRoutes } from "./routes/requests.ts";
import { agentRoutes } from "./routes/agents.ts";
import { logRoutes } from "./routes/logs.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { integrationRoutes } from "./routes/integrations.ts";
import { healthRoutes, systemRoutes } from "./routes/system.ts";
import type { McpSessionManager } from "./mcp-server.ts";

const API_MAX_BODY_BYTES = 1_000_000;

interface RouteTiming {
   pattern: string;
   startedAt: number;
   }

export function createApiApp(
   application: AppContext,
   mcpManager: McpSessionManager,
   ): Hono<{ Variables: { app: AppContext } }> {
   const api = new Hono<{ Variables: { app: AppContext } }>();

   api.use("*", async (c, next) => {
      c.set("app", application);
      const startedAt = performance.now();
      await next();
      const durationSeconds = (performance.now() - startedAt) / 1000;
      const status = c.res.status;
      const statusClass = `${Math.floor(status / 100)}xx`;
      const pattern = routePattern(c.req.path);
      application.metrics.httpRequestsTotal.inc(1, {
         method: c.req.method,
         route: pattern,
         status: statusClass,
            });
      application.metrics.httpDuration.observe(durationSeconds, { route: pattern });
         });

   api.use("*", async (c, next) => {
      c.header("X-Content-Type-Options", "nosniff");
      c.header("X-Frame-Options", "DENY");
      c.header("Referrer-Policy", "no-referrer");
      c.header("Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
      c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
         const origin = c.req.header("origin");
         if (origin) {
               const host = c.req.header("host");
               try {
                     if (new URL(origin).host !== host) {
                           return json(c, { success: false, error: { message: "Cross-origin writes are blocked." } }, 403);
                                 }
                        } catch {
                     return json(c, { success: false, error: { message: "Invalid origin header." } }, 400);
                                 }
                     }
               const contentLength = Number(c.req.header("content-length") ?? "0");
               if (contentLength > API_MAX_BODY_BYTES) {
                     return json(c, { success: false, error: { message: "Request body too large." } }, 413);
                         }
                  }
      await next();
         });

   api.onError((error, c) => {
      const applicationContext = c.get("app") as AppContext | undefined;
      const message = error instanceof Error ? redactText(error.message) : "Unexpected error";
      applicationContext?.log("api").error("unhandled API error", {
         path: c.req.path,
         error: message,
            });
      return json(c, { success: false, error: { message: internalErrorMessage() } }, 500);
         });

   api.notFound((c) =>
      json(c, { success: false, error: { message: `Not found: ${c.req.path}` } }, 404));

   api.route("/", healthRoutes(application));
   api.route("/api", dashboardRoutes());
   api.route("/api", requestRoutes());
   api.route("/api", agentRoutes());
   api.route("/api", logRoutes());
   api.route("/api", settingsRoutes());
   api.route("/api", integrationRoutes());
   api.route("/api", systemRoutes());

   api.get("/metrics", (c) => {
      const applicationContext = getApp(c);
      applicationContext.metrics.activeClients.set(
         activeClientsCount(applicationContext),
            );
      const connection = applicationContext.client.getConnectionStatus();
      applicationContext.metrics.jevUpstream.set(
         connection.state === "connected" || connection.state === "recovered" ? 1 : 0,
            );
      return new Response(applicationContext.metrics.registry.render(), {
         headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
            });
         });

   api.get("/api/bootstrap", (c) => {
      const applicationContext = getApp(c);
      const settings = applicationContext.getSettings();
      return json(c, {
         success: true,
         data: {
               version: {
                     version: applicationContext.versionInfo.version,
                     applicationName: "JevAI-MCP",
                     commit: applicationContext.versionInfo.commit,
                     buildDate: applicationContext.versionInfo.buildDate,
                           },
               defaultTimeRange: settings.ui.defaultTimeRange,
               refreshIntervalSeconds: settings.ui.refreshIntervalSeconds,
               mcpUrl: mcpUrlFromSettings(settings),
               apiKeySource: applicationContext.apiKeySource(),
               thresholds: DEFAULT_CONFIDENCE_THRESHOLDS,
               tokenSavings: {
                     enabled: settings.metrics.tokenSavingsEnabled,
                     estimatedAvoidedTokens: settings.metrics.estimatedAvoidedTokens,
                           },
               mcpEnabled: settings.mcp.enabled,
                     },
                  });
         });

   api.get("/api/version", (c) => json(c, { success: true, data: getApp(c).versionInfo }));

   api.get("/api/health", (c) => {
      const payload = healthProxy(application);
      return c.json(payload as never, payload.status === "unhealthy" ? 503 : 200);
         });

   api.post("/api/mcp/probe/:tool", async (c) => {
      const applicationContext = getApp(c);
      const tool = c.req.param("tool");
      const { handleToolCall, collectingRecorder, toolByName } = await import("@jevai/mcp-tools");
      if (!toolByName.has(tool)) {
         return json(c, { success: false, error: { message: `Unknown tool ${tool}` } }, 404);
            }
      let body: Record<string, unknown>;
      try {
            body = (await c.req.json()) as Record<string, unknown>;
               } catch {
         return json(c, { success: false, error: { message: "Body must be JSON" } }, 400);
               }
      const recorder = collectingRecorder();
      const fallbackDeps = buildFallbackDeps(applicationContext);
      const result = await handleToolCall(tool, body, {
         client: applicationContext.client,
         recorder,
         privacy: () => ({ requestState: "off", storeResponses: false }),
         thresholds: () => ({ ...DEFAULT_CONFIDENCE_THRESHOLDS }),
         ...(fallbackDeps ?? {}),
            });
      return c.json({ success: !result.isError, data: result.payload } as never,
            result.isError ? 502 : 200);
         });

   // MCP endpoint served on the API port alongside the dashboard.
   api.on(["POST", "GET", "DELETE"], "/mcp", async (c) => {
      const applicationContext = getApp(c);
      if (!applicationContext.getSettings().mcp.enabled) {
         return new Response(
               JSON.stringify({
                     jsonrpc: "2.0",
                     error: { code: -32000, message: "MCP server is disabled in settings." },
                     id: null,
                        }),
                 { status: 503, headers: { "Content-Type": "application/json" } },
                     );
            }
      const response = await mcpManager.handleRequest(c.req.raw);
      return response;
         });

   const webDir = application.resolveWebDir();
   if (webDir) {
      mountStaticWeb(api, application, webDir);
         } else {
      api.get("/", (c) =>
         c.html(
               "<!doctype html><html><head><meta charset='utf-8'><title>JevAI-MCP</title></head>" +
                  "<body style='font-family: system-ui; padding: 2rem'>" +
                  "<h1>JevAI-MCP</h1><p>The dashboard bundle was not found (apps/web/dist). " +
                  "Run <code>npm run build</code> or set WEB_DIR.</p>" +
                  `<p>API base: <code>/api</code> · MCP endpoint: <code>${mcpUrlFromSettings(
                        application.getSettings(),
                     )}/mcp</code></p></body></html>`,
               200,
                 ));
         }

   return api;
}

const STATIC_CACHE = "public, max-age=0, must-revalidate";

function mountStaticWeb(
   api: Hono<{ Variables: { app: AppContext } }>,
   application: AppContext,
   webDir: string,
): void {
   const mime = (file: string): string => {
      if (file.endsWith(".js")) return "text/javascript";
      if (file.endsWith(".css")) return "text/css";
      if (file.endsWith(".html")) return "text/html";
      if (file.endsWith(".svg")) return "image/svg+xml";
      if (file.endsWith(".json")) return "application/json";
      if (file.endsWith(".png")) return "image/png";
      if (file.endsWith(".ico")) return "image/x-icon";
      if (file.endsWith(".woff2")) return "font/woff2";
      return "application/octet-stream";
      };

   api.use("/*", async (c, next) => {
      const method = c.req.method;
      if (method !== "GET" && method !== "HEAD") {
         await next();
         return;
            }
      const requestPath = c.req.path;
      if (
         requestPath.startsWith("/api") ||
            requestPath === "/metrics" ||
            requestPath === "/health" ||
            requestPath.startsWith("/health/") ||
            requestPath === "/version" ||
            requestPath === "/mcp"
            ) {
         await next();
         return;
            }
      const served = serveFile(webDir, requestPath, mime);
      if (served) {
         return served;
            }
      await next();
         });

   api.get("*", (c) => {
      const requestPath = c.req.path;
      if (
         requestPath.startsWith("/api") ||
            requestPath === "/metrics" ||
            requestPath === "/mcp" ||
            requestPath.startsWith("/health")
            ) {
         return c.notFound();
            }
      const index = path.join(webDir, "index.html");
      if (existsSync(index)) {
         return new Response(readFileSync(index), {
               headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
                  });
            }
      return c.notFound();
         });
   void application;
}

function serveFile(
   webDir: string,
   requestPath: string,
   mime: (file: string) => string,
): Response | null {
   const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
   const resolved = path.resolve(webDir, relative);
   if (!resolved.startsWith(path.resolve(webDir))) return null;
   if (!existsSync(resolved)) return null;
   try {
      const content = readFileSync(resolved);
      return new Response(content, {
         headers: { "Content-Type": mime(resolved), "Cache-Control": STATIC_CACHE },
            });
         } catch {
   return null;
         }
}

function routePattern(requestPath: string): string {
   const segments = requestPath.split("/").filter(Boolean);
   const patternSegments = segments.map((segment) =>
         /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
            /^\d+$/.test(segment)
                  ? ":id"
                  : segment);
   return `/${patternSegments.slice(0, 4).join("/")}`;
}

function internalErrorMessage(): string {
   return "Internal error. Check the Logs page for details.";
}

function healthProxy(application: AppContext) {
   const connection = application.client.getConnectionStatus();
   const databaseHealthy = application.db.healthy();
   return {
      status: !databaseHealthy ? "unhealthy" : connection.state === "connected" ? "healthy" : "degraded",
      jev: connection.state,
      database: databaseHealthy ? "healthy" : "unhealthy",
      mcp: application.getSettings().mcp.enabled ? "running" : "disabled",
         };
}

export type { RouteTiming, Context, Next };
