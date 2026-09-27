import { Hono } from "hono";
import { redactText } from "@jevai/shared";
import type { AppContext } from "../context.ts";
import { app, errorResponse, json, pagination, parseTimeRange } from "./common.ts";

export function requestRoutes(): Hono<{ Variables: { app: AppContext } }> {
   const routes = new Hono<{ Variables: { app: AppContext } }>();

   routes.get("/requests", (c) => {
      const application = app(c);
      const query = c.req.query();
      const range = parseTimeRange(new URLSearchParams(query));
      const { limit, offset } = pagination(new URLSearchParams(query));
      const result = application.db.requests.list({
         caller: query.caller || undefined,
         tool: query.tool || undefined,
         status:
               query.status === "success" || query.status === "error"
                    ? query.status
                      : undefined,
         model: query.model || undefined,
         from: query.range === "custom" ? range.from : range.from,
         to: range.to,
         search: query.search || undefined,
         limit,
         offset,
            });

      const records = result.records.map((record) => ({
         id: record.id,
         requestId: record.requestId,
         timestamp: record.timestamp,
         caller: record.caller,
         tool: record.tool,
         model: record.model,
         durationMs: record.durationMs,
         inputTokens: record.inputTokens,
         outputTokens: record.outputTokens,
         status: record.status,
         errorCategory: record.errorCategory,
         questionCount: record.questionCount,
         stateSizeChars: record.stateSizeChars,
         clientVersion: record.clientVersion,
         project: record.project,
            }));

      return json(c, { success: true, data: { records, total: result.total } });
         });

   routes.get("/requests/facets", (c) => {
      const application = app(c);
      return json(c, {
         success: true,
         data: {
               callers: application.db.requests.distinctValues("caller"),
               tools: application.db.requests.distinctValues("tool"),
               models: application.db.requests.distinctValues("model"),
                   },
             });
         });

   routes.get("/requests/:id", (c) => {
      const application = app(c);
      const id = Number.parseInt(c.req.param("id"), 10);
      if (!Number.isFinite(id)) return errorResponse(c, 400, "Invalid request id");
      const record = application.db.requests.byId(id);
      if (!record) return errorResponse(c, 404, "Request not found");

      const settings = application.getSettings();
      const detail: Record<string, unknown> = {
         id: record.id,
         requestId: record.requestId,
         timestamp: record.timestamp,
         caller: record.caller,
         tool: record.tool,
         model: record.model,
         durationMs: record.durationMs,
         inputTokens: record.inputTokens,
         outputTokens: record.outputTokens,
         status: record.status,
         errorCategory: record.errorCategory,
         questionCount: record.questionCount,
         stateSizeChars: record.stateSizeChars,
         clientVersion: record.clientVersion,
         project: record.project,
         repository: record.repository,
         sessionId: record.sessionId,
         contentPolicy: {
               requestState: settings.storage.requestState,
               storeResponses: settings.storage.storeResponses,
                   },
            };

      if (settings.storage.requestState === "full" && record.stateJson) {
         detail.state = safeParse(record.stateJson);
            } else if (settings.storage.requestState === "metadata_only") {
         detail.state = null;
         detail.stateNote = "Request state is not stored (policy: metadata only).";
            } else {
         detail.state = null;
         detail.stateNote = "Request state storage is disabled.";
            }

      if (settings.storage.storeResponses && record.responseJson) {
         detail.response = safeParse(record.responseJson);
            } else {
         detail.response = null;
         detail.responseNote = "Response storage is disabled.";
            }

      if (record.status === "error") {
         detail.errorMessage = record.errorMessage ? maskShort(record.errorMessage) : null;
            }

      return json(c, { success: true, data: detail });
         });

   return routes;
}

function safeParse(raw: string): unknown {
   try {
      return JSON.parse(raw);
          } catch {
      return raw;
          }
}

function maskShort(message: string): string {
   return redactText(message.length > 300 ? `${message.slice(0, 300)}…` : message);
}
