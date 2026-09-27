import process from "node:process";
import { Hono } from "hono";
import { zipSync, strToU8 } from "fflate";
import { mcpUrlFromSettings, type AppSettings } from "@jevai/shared";
import type { AppContext } from "../context.ts";
import { app, json } from "./common.ts";

export function healthRoutes(application: AppContext): Hono<{ Variables: { app: AppContext } }> {
   const routes = new Hono<{ Variables: { app: AppContext } }>();

   const healthPayload = () => {
      const connection = application.client.getConnectionStatus();
      const databaseHealthy = application.db.healthy();
      const settings = application.getSettings();
      const mcp = settings.mcp.enabled ? "running" : "disabled";
      const jevConnected =
         connection.state === "connected" || connection.state === "recovered";
      const status = !databaseHealthy
         ? "unhealthy"
          : jevConnected && databaseHealthy
               ? "healthy"
               : "degraded";
      return {
         status,
         jev: connection.state,
         database: databaseHealthy ? "healthy" : "unhealthy",
         mcp,
         version: application.versionInfo.version,
         uptimeSeconds: Math.round((Date.now() - application.startedAt.getTime()) / 1000),
            };
      };

   routes.get("/health", (c) => {
      const payload = healthPayload();
      const status = payload.status === "unhealthy" ? 503 : 200;
      return json(c, payload, status as 200 | 503);
         });

   routes.get("/health/live", (c) =>
      json(c, { status: "alive", version: application.versionInfo.version }),
         );

   routes.get("/health/ready", (c) => {
      const databaseHealthy = application.db.healthy();
      const settings = application.getSettings();
      const ready = databaseHealthy;
      return json(
         c,
            {
               status: ready ? "ready" : "not_ready",
               database: ready ? "healthy" : "unhealthy",
               mcp: settings.mcp.enabled ? "running" : "disabled",
                  },
            ready ? 200 : 503,
            );
         });

   routes.get("/version", (c) => json(c, { success: true, data: application.versionInfo }));

   return routes;
}

export function systemRoutes(): Hono<{ Variables: { app: AppContext } }> {
   const routes = new Hono<{ Variables: { app: AppContext } }>();

   routes.get("/system/status", (c) => {
      const application = app(c);
      const settings = application.getSettings();
      const connection = application.client.getConnectionStatus();
      return json(c, {
         success: true,
         data: {
               application: {
                     version: application.versionInfo.version,
                     commit: application.versionInfo.commit,
                     buildDate: application.versionInfo.buildDate,
                     startedAt: application.startedAt.toISOString(),
                     uptimeSeconds: Math.round((Date.now() - application.startedAt.getTime()) / 1000),
                     node: process.version,
                     platform: `${process.platform}/${process.arch}`,
                          },
               jev: {
                     state: connection.state,
                     endpoint: application.client.getEndpoint(),
                     model: application.client.getModel(),
                     apiKeySource: application.apiKeySource(),
                     lastSuccessAt: connection.lastSuccessAt,
                     lastFailureAt: connection.lastFailureAt,
                     lastFailureReason: connection.lastFailureReason,
                     lastFailureStatus: connection.lastFailureStatus,
                     totalDisconnects: application.db.connectionEvents.totalDisconnects(),
                          },
               mcp: { ...settings.mcp, url: mcpUrlFromSettings(settings) },
               database: {
                     path: application.db.path === ":memory:" ? ":memory:" : "persistent",
                     healthy: application.db.healthy(),
                     sizeBytes: application.databaseFileSizeBytes(),
                     schemaVersion: application.db.stats(application.databaseFileSizeBytes()).schemaVersion,
                          },
               memory: {
                     rssBytes: Math.round(process.memoryUsage().rss),
                     heapUsedBytes: Math.round(process.memoryUsage().heapUsed),
                          },
                    },
               });
            });

   routes.get("/system/connection-events", (c) => {
      const application = app(c);
      const limit = Math.min(
         Number.parseInt(c.req.query("limit") ?? "100", 10) || 100,
         1000,
            );
      const events = application.db.connectionEvents.latest(limit);
      return json(c, {
         success: true,
         data: {
               events,
               current: application.client.getConnectionStatus(),
               totalDisconnects: application.db.connectionEvents.totalDisconnects(),
                    },
               });
            });

   routes.get("/system/diagnostics", (c) => {
      const application = app(c);
      const settings = application.getSettings();
      const recentErrors = application.db.logs.list({ level: "error", limit: 200 });
      const recentWarns = application.db.logs.list({ level: "warn", limit: 100 });
      const bundle = {
         generatedAt: new Date().toISOString(),
         application: {
               version: application.versionInfo.version,
               commit: application.versionInfo.commit,
               buildDate: application.versionInfo.buildDate,
                    },
         configuration: redactedConfiguration(settings),
         apiKeySource: application.apiKeySource(),
         health: {
               status: application.db.healthy() ? "healthy" : "unhealthy",
               jev: application.client.getConnectionStatus(),
               mcpEnabled: settings.mcp.enabled,
                    },
         connectionHistory: application.db.connectionEvents.latest(50),
         systemInformation: {
               node: process.version,
               platform: `${process.platform}/${process.arch}`,
               uptimeSeconds: Math.round((Date.now() - application.startedAt.getTime()) / 1000),
               memoryUsage: process.memoryUsage(),
                    },
         databaseStatistics: application.db.stats(application.databaseFileSizeBytes()),
         recentErrors: recentErrors.records,
         recentWarnings: recentWarns.records,
         note: "Secrets are redacted. The API key is never included.",
            };

      if (c.req.query("format") === "json") {
         return json(c, { success: true, data: bundle });
             }
      const zipped = zipSync({
         "diagnostics.json": strToU8(JSON.stringify(bundle, null, 2)),
         "recent-logs.json": strToU8(
               JSON.stringify(application.db.logs.list({ limit: 2_000 }).records, null, 2),
                     ),
            });
      return new Response(zipped, {
         headers: {
               "Content-Type": "application/zip",
               "Content-Disposition": `attachment; filename="jevai-mcp-diagnostics-${Date.now()}.zip"`,
                     },
            });
            });

   routes.post("/system/test-jev-connection", async (c) => {
      const application = app(c);
      const result = await application.client.testConnection();
      return json(c, { success: true, data: result }, result.ok ? 200 : 502);
         });

   routes.post("/system/run-retention", (c) => {
      const application = app(c);
      const result = application.db.applyRetention(application.getSettings());
      application.logs.sink?.close();
      application.log("system").info("manual retention run", { ...result });
      return json(c, { success: true, data: result });
         });

   return routes;
}

function redactedConfiguration(settings: AppSettings): AppSettings {
   return structuredClone(settings);
}
