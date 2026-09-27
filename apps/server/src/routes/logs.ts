import { Hono } from "hono";
import type { LogComponent, LogLevel } from "@jevai/shared";
import type { AppContext } from "../context.ts";
import { app, json, pagination } from "./common.ts";

const LEVELS = ["debug", "info", "warn", "error"] as const;
const COMPONENTS = ["mcp", "jev", "api", "database", "system", "frontend"] as const;

export function logRoutes(): Hono<{ Variables: { app: AppContext } }> {
   const routes = new Hono<{ Variables: { app: AppContext } }>();

   routes.get("/logs", (c) => {
      const application = app(c);
      const query = c.req.query();
      const { limit, offset } = pagination(new URLSearchParams(query));
      const after = query.after ? Number.parseInt(query.after, 10) : undefined;

      const result = application.db.logs.list({
         level: (LEVELS as readonly string[]).includes(query.level ?? "")
                 ? (query.level as LogLevel)
                     : undefined,
         component: (COMPONENTS as readonly string[]).includes(query.component ?? "")
                 ? (query.component as LogComponent)
                     : undefined,
         search: query.search || undefined,
         from: query.from || undefined,
         to: query.to || undefined,
         limit,
         offset,
             });

      const maxId = result.records.reduce((max, record) => Math.max(max, record.id), 0);
      return json(c, {
         success: true,
         data: { records: result.records, total: result.total, maxId },
         ...(after !== undefined ? { live: result.records.filter((r) => r.id > after) } : {}),
              });
          });

   routes.get("/logs/download", (c) => {
      const application = app(c);
      const query = c.req.query();
      const format = query.format === "text" ? "text" : "json";
      const result = application.db.logs.list({
         level: (LEVELS as readonly string[]).includes(query.level ?? "")
                 ? (query.level as LogLevel)
                     : undefined,
         component: (COMPONENTS as readonly string[]).includes(query.component ?? "")
                 ? (query.component as LogComponent)
                     : undefined,
         search: query.search || undefined,
         from: query.from || undefined,
         to: query.to || undefined,
         limit: 10_000,
         offset: 0,
             });

      if (format === "text") {
         const lines = result.records.map((record) => {
               const context = record.context ? ` ${JSON.stringify(record.context)}` : "";
               return `[${record.timestamp}] ${record.level.toUpperCase().padEnd(5)} [${record.component}] ${record.message}${context}`;
                     });
         return new Response(lines.join("\n"), {
               headers: {
                     "Content-Type": "text/plain; charset=utf-8",
                     "Content-Disposition": `attachment; filename="jevai-mcp-logs-${Date.now()}.txt"`,
                        },
                     });
              }
      return new Response(JSON.stringify(result.records, null, 2), {
         headers: {
               "Content-Type": "application/json",
               "Content-Disposition": `attachment; filename="jevai-mcp-logs-${Date.now()}.json"`,
                  },
                });
          });

   return routes;
}
