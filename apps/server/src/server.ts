import process from "node:process";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { AppContext } from "./context.ts";
import { createApiApp } from "./api.ts";
import { createMcpSessionManager } from "./mcp-server.ts";

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
   const application = AppContext.create();
   application.loadPersistedSettings();
   const log = application.log("system");
   const settings = application.getSettings();

   const mcpManager = await createMcpSessionManager(application);
   const apiApp = createApiApp(application, mcpManager);

   const httpPort = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;
   const mcpPort = settings.mcp.port;
   const bindHost = "HOST" in process.env ? process.env.HOST : "0.0.0.0";

   const apiServer = serve({
      fetch: apiApp.fetch,
      port: httpPort,
      hostname: bindHost,
        });
   const mcpServer = serve({
      fetch: (request) => {
         const url = new URL(request.url);
         if (url.pathname === "/health" || url.pathname === "/health/live") {
               return new Response(
                     JSON.stringify({ status: "alive", version: application.versionInfo.version }),
                        { headers: { "Content-Type": "application/json" } },
                        );
                     }
         if (url.pathname === "/health/ready") {
               const ok = application.db.healthy();
               return new Response(
                     JSON.stringify({ status: ok ? "ready" : "not_ready" }),
                        { status: ok ? 200 : 503, headers: { "Content-Type": "application/json" } },
                        );
                     }
         if (url.pathname === "/health") {
               return new Response(
                     JSON.stringify(
                           mcpHealthSnapshot(application),
                           ),
                        { headers: { "Content-Type": "application/json" } },
                        );
                     }
         if (url.pathname === "/mcp") {
               if (!application.getSettings().mcp.enabled) {
                     return new Response(
                           JSON.stringify({
                                 jsonrpc: "2.0",
                                 error: { code: -32000, message: "MCP server is disabled." },
                                 id: null,
                                    }),
                              { status: 503, headers: { "Content-Type": "application/json" } },
                                 );
                     }
               return mcpManager.handleRequest(request);
                     }
         return new Response(
               JSON.stringify({
                     jsonrpc: "2.0",
                     error: { code: -32001, message: "Not found." },
                     id: null,
                         }),
               { status: 404, headers: { "Content-Type": "application/json" } },
                  );
                },
      port: mcpPort,
      hostname: settings.mcp.host,
         });

   log.info("JevAI-MCP started", {
      version: application.versionInfo.version,
      httpPort,
      mcpPort,
      apiKeySource: application.apiKeySource(),
      backupCredentials: application.backupLabels(),
      database: application.db.path === ":memory:" ? ":memory:" : "file",
         });

   const runRetention = () => {
      try {
         const result = application.db.applyRetention(application.getSettings());
         if (result.requestsDeleted + result.logsDeleted + result.connectionEventsDeleted > 0) {
               log.info("retention run removed old records", { ...result });
                  }
            } catch (error) {
         log.error("retention run failed", {
               error: error instanceof Error ? error.message : String(error),
                  });
            }
          };
   runRetention();
   const retentionTimer = setInterval(runRetention, RETENTION_INTERVAL_MS);
   retentionTimer.unref();

   let shuttingDown = false;
   const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info("shutting down", { signal });
      clearInterval(retentionTimer);
      const forceTimer = setTimeout(() => {
         log.warn("graceful shutdown timed out, forcing exit");
         process.exit(1);
            }, 10_000);
      forceTimer.unref();
      try {
         await mcpManager.close();
         await closeServers([apiServer, mcpServer]);
         application.logs.sink?.flush();
         application.close();
         log.info("shutdown complete");
         process.exit(0);
            } catch (error) {
         log.error("shutdown failed", {
               error: error instanceof Error ? error.message : String(error),
                  });
         process.exit(1);
            }
       };

   process.on("SIGTERM", () => void shutdown("SIGTERM"));
   process.on("SIGINT", () => void shutdown("SIGINT"));
   process.on("uncaughtException", (error) => {
      log.error("uncaught exception", { error: error.message, stack: error.stack });
   });
   process.on("unhandledRejection", (reason) => {
      log.error("unhandled rejection", {
         reason: reason instanceof Error ? reason.message : String(reason),
            });
   });
}

function mcpHealthSnapshot(application: AppContext) {
   const connection = application.client.getConnectionStatus();
   return {
      status: application.db.healthy() ? "healthy" : "unhealthy",
      jev: connection.state,
      database: application.db.healthy() ? "healthy" : "unhealthy",
      mcp: application.getSettings().mcp.enabled ? "running" : "disabled",
   };
}

function closeServers(servers: ServerType[]): Promise<void> {
   return new Promise((resolve) => {
      let pending = servers.length;
      if (pending === 0) resolve();
      for (const server of servers) {
         try {
               (server as import("node:http").Server).closeAllConnections?.();
               (server as import("node:http").Server).close(() => {
                     pending -= 1;
                     if (pending <= 0) resolve();
                        });
                  } catch {
               pending -= 1;
               if (pending <= 0) resolve();
                  }
            }
      setTimeout(resolve, 3_000).unref();
         });
}

main().catch((error) => {
      console.error("fatal startup error", error);
   process.exit(1);
});
