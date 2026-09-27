import { Hono } from "hono";
import { KNOWN_CALLERS } from "@jevai/shared";
import type { AppContext } from "../context.ts";
import { app, json, parseTimeRange } from "./common.ts";

export interface AgentStat {
   caller: string;
   known: boolean;
   requests: number;
   successRate: number | null;
   avgDurationMs: number | null;
   inputTokens: number;
   mostUsedTool: string | null;
   lastSeenAt: string | null;
   lastSeenSecondsAgo: number | null;
}

export function agentRoutes(): Hono<{ Variables: { app: AppContext } }> {
   const routes = new Hono<{ Variables: { app: AppContext } }>();

   routes.get("/agents", (c) => {
      const application = app(c);
      const range = parseTimeRange(c.req.query());
      const rows = application.db.requests.groupByColumn("caller", range.from, range.to);
      const now = Date.now();

      const agents: AgentStat[] = rows.map((row) => {
         const successRate = row.count > 0 ? (row.success / row.count) * 100 : null;
         const lastSeenMs = row.lastSeenAt ? Date.parse(row.lastSeenAt) : null;
         return {
               caller: row.key,
               known: (KNOWN_CALLERS as readonly string[]).includes(row.key),
               requests: row.count,
               successRate: successRate === null ? null : Math.round(successRate * 10) / 10,
               avgDurationMs: row.avgDurationMs,
               inputTokens: row.inputTokens,
               mostUsedTool: application.db.requests.mostUsedToolForCaller(
                     row.key,
                     range.from,
                     range.to,
                        ),
               lastSeenAt: row.lastSeenAt,
               lastSeenSecondsAgo:
                     lastSeenMs === null ? null : Math.max(0, Math.round((now - lastSeenMs) / 1000)),
                    };
             });

      const zeroed: AgentStat[] = (KNOWN_CALLERS as readonly string[])
           .filter((caller) => !agents.some((agent) => agent.caller === caller))
           .map((caller) => ({
               caller,
               known: true,
               requests: 0,
               successRate: null,
               avgDurationMs: null,
               inputTokens: 0,
               mostUsedTool: null,
               lastSeenAt: null,
               lastSeenSecondsAgo: null,
                 }));

      return json(c, { success: true, data: [...agents, ...zeroed] });
         });

   return routes;
}
