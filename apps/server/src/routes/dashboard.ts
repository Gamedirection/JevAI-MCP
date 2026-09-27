import { Hono } from "hono";
import {
   MCP_TOOL_NAMES,
   guidanceLevel,
   noulVerdict,
   type TimeRangePreset,
} from "@jevai/shared";
import type { AppContext } from "../context.ts";
import { app, json, parseTimeRange } from "./common.ts";

export interface DashboardPayload {
   timeRange: { from: string; to: string; label: string; bucketSeconds: number };
   summary: {
      totalCalls: number;
      successfulCalls: number;
      failedCalls: number;
      successRate: number | null;
      avgDurationMs: number | null;
      inputTokens: number;
      estimatedTokensSaved: number | null;
      tokenSavingsEnabled: boolean;
      activeClients: number;
      lastRequestAt: string | null;
      };
   serviceStatus: {
      app: "healthy" | "degraded";
      jev: string;
      database: "healthy" | "unhealthy";
      mcp: "running" | "disabled" | "stopped";
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastFailureReason: string | null;
      totalDisconnects: number;
      };
   timeline: Array<{
      bucket: string;
      success: number;
      failed: number;
      avgDurationMs: number | null;
      inputTokens: number;
         }>;
   byCaller: Array<{
      key: string;
      count: number;
      success: number;
      failed: number;
      avgDurationMs: number | null;
      inputTokens: number;
      lastSeenAt: string | null;
         }>;
   byTool: Array<{
      key: string;
      count: number;
      success: number;
      failed: number;
      avgDurationMs: number | null;
      inputTokens: number;
      lastSeenAt: string | null;
         }>;
   }

export function dashboardRoutes(): Hono<{ Variables: { app: AppContext } }> {
   const routes = new Hono<{ Variables: { app: AppContext } }>();

   routes.get("/dashboard", (c) => {
      const application = app(c);
      const range = parseTimeRange(c.req.query());
      const settings = application.getSettings();

      const summary = application.db.requests.summary(range.from, range.to);
      const byCallerRows = application.db.requests.groupByColumn("caller", range.from, range.to);
      const byToolRows = application.db.requests.groupByColumn("tool", range.from, range.to);
      const timeline = application.db.requests.timeline(
         range.from,
         range.to,
         range.bucketSeconds,
           );
      const connection = application.client.getConnectionStatus();
      const successRate =
         summary.total > 0 ? (summary.success / summary.total) * 100 : null;
      const estimatedTokensSaved = settings.metrics.tokenSavingsEnabled
         ? summary.success * settings.metrics.estimatedAvoidedTokens
          : null;

      const payload: DashboardPayload = {
         timeRange: {
               from: range.from,
               to: range.to,
               label: range.label,
               bucketSeconds: range.bucketSeconds,
                  },
         summary: {
               totalCalls: summary.total,
               successfulCalls: summary.success,
               failedCalls: summary.failed,
               successRate: successRate === null ? null : Math.round(successRate * 10) / 10,
               avgDurationMs: summary.avgDurationMs,
               inputTokens: summary.inputTokens,
               estimatedTokensSaved,
               tokenSavingsEnabled: settings.metrics.tokenSavingsEnabled,
               activeClients: byCallerRows.length,
               lastRequestAt: summary.lastRequestAt,
                  },
         serviceStatus: {
               app:
                     connection.state === "connected" || connection.state === "recovered"
                          ? "healthy"
                            : application.db.healthy()
                                 ? "degraded"
                                  : "degraded",
               jev: connection.state,
               database: application.db.healthy() ? "healthy" : "unhealthy",
               mcp: settings.mcp.enabled ? "running" : "disabled",
               lastSuccessAt: connection.lastSuccessAt,
               lastFailureAt: connection.lastFailureAt,
               lastFailureReason: connection.lastFailureReason,
               totalDisconnects: application.db.connectionEvents.totalDisconnects(),
                  },
         timeline,
         byCaller: byCallerRows.map((row) => ({ ...row })),
         byTool: byToolRows
               .filter((row) => (MCP_TOOL_NAMES as readonly string[]).includes(row.key) || true)
               .map((row) => ({ ...row })),
            };

      return json(c, { success: true, data: payload });
        });

   routes.get("/overview/thresholds", (c) => {
      const exampleUse = guidanceLevel(0.85);
      const exampleGuidance = guidanceLevel(0.6);
      const exampleIndependent = guidanceLevel(0.4);
      return json(c, {
         success: true,
         data: {
               choiceGuidance: [
                     { level: "use", example: exampleUse, rule: "confidence >= 0.80" },
                     { level: "guidance", example: exampleGuidance, rule: "0.55 - 0.79" },
                     { level: "independent", example: exampleIndependent, rule: "< 0.55" },
                       ],
               noulVerdicts: [
                     { verdict: noulVerdict(0.9), rule: "probability >= 0.80" },
                     { verdict: noulVerdict(0.1), rule: "probability <= 0.20" },
                     { verdict: noulVerdict(0.5), rule: "in between" },
                       ],
               note: "Defaults. Tune per agent instructions.",
                  },
            });
        });

   return routes;
}

export function activeClientsCount(
   application: AppContext,
   windowMs = 24 * 3_600_000,
): number {
   const now = new Date();
   const from = new Date(now.getTime() - windowMs).toISOString();
   const to = now.toISOString();
   return application.db.requests.groupByColumn("caller", from, to).length;
}

export type { TimeRangePreset };
