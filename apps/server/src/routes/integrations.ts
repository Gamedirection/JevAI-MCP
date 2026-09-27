import { Hono } from "hono";
import { zipSync, strToU8 } from "fflate";
import { mcpUrlFromSettings } from "@jevai/shared";
import type { AppContext } from "../context.ts";
import { app, errorResponse, json } from "./common.ts";
import { allGuides, type IntegrationGuide } from "../integrations-content.ts";

const GUIDE_IDS = ["codex", "claude", "opencode", "gemini", "generic"] as const;

const CALLER_BY_GUIDE: Record<"codex" | "claude" | "opencode" | "gemini", string> = {
   codex: "codex",
   claude: "claude-code",
   opencode: "opencode",
   gemini: "gemini",
};

function guideFor(application: AppContext, id: string): IntegrationGuide | undefined {
   const settings = application.getSettings();
   const ctx = {
      mcpUrl: mcpUrlFromSettings(settings),
      serverName: "jevai",
      appName: "JevAI-MCP",
      };
   return allGuides(ctx).find((guide) => guide.id === id);
}

export function integrationRoutes(): Hono<{ Variables: { app: AppContext } }> {
   const routes = new Hono<{ Variables: { app: AppContext } }>();

   routes.get("/integrations", (c) => {
      const application = app(c);
      const settings = application.getSettings();
      const ctx = {
         mcpUrl: mcpUrlFromSettings(settings),
         serverName: "jevai",
         appName: "JevAI-MCP",
            };
      const guides = allGuides(ctx).map((guide) => ({
         id: guide.id,
         displayName: guide.displayName,
         summary: guide.summary,
         requirements: guide.requirements,
         steps: guide.steps,
         verify: guide.verify,
         testCommand: guide.testCommand,
         troubleshooting: guide.troubleshooting,
         files: guide.files.map((file) => ({ path: file.path, size: file.content.length })),
         zipName: guide.zipName,
         lastCallAt:
               guide.id === "generic"
                     ? null
                           : application.db.requests.latestCallForCaller(
                                   CALLER_BY_GUIDE[guide.id]),
              }));
      return json(c, { success: true, data: { mcpUrl: ctx.mcpUrl, guides } });
           });

   routes.get("/integrations/:id/file/:file", (c) => {
      const application = app(c);
      const guide = guideFor(application, c.req.param("id") ?? "");
      if (!guide) return errorResponse(c, 404, "Unknown integration");
      const wanted = c.req.param("file") ?? "";
      const file = guide.files.find((entry) => entry.path === wanted);
      if (!file) return errorResponse(c, 404, "Unknown file");
      return new Response(file.content, {
         headers: { "Content-Type": "text/markdown; charset=utf-8" },
              });
           });

   routes.get("/integrations/:id/download", (c) => {
      const application = app(c);
      const guide = guideFor(application, c.req.param("id") ?? "");
      if (!guide) return errorResponse(c, 404, "Unknown integration");
      return zipResponse(guide.files, guide.zipName);
           });

   routes.get("/integrations/download-all", (c) => {
      const application = app(c);
      const ctx = {
         mcpUrl: mcpUrlFromSettings(application.getSettings()),
         serverName: "jevai",
         appName: "JevAI-MCP",
             };
      const entries: Array<[string, Uint8Array]> = [];
      for (const guide of allGuides(ctx)) {
         for (const file of guide.files) {
               entries.push([`${guide.id}/${file.path}`, strToU8(file.content)]);
                  }
            }
      const zipped = zipSync(Object.fromEntries(entries));
      return new Response(zipped, {
         headers: {
               "Content-Type": "application/zip",
               "Content-Disposition": `attachment; filename="jevai-mcp-all-integrations-${Date.now()}.zip"`,
                  },
              });
           });

   routes.post("/integrations/test-decision", async (c) => {
      const application = app(c);
      let body: {
         state?: unknown;
         question?: unknown;
         options?: unknown;
           };
      try {
            body = (await c.req.json()) as typeof body;
                 } catch {
         return errorResponse(c, 400, "Body must be JSON");
                 }
      const state =
            typeof body.state === "string" && body.state.trim()
                  ? body.state
                  : "A production application returns HTTP 502 through Kubernetes ingress.";
      const question =
            typeof body.question === "string" && body.question.trim()
                  ? body.question
                  : "Which subsystem should be investigated first?";
      const rawOptions = Array.isArray(body.options)
            ? body.options.filter((option): option is string => typeof option === "string")
                  : ["application", "service", "ingress", "storage", "database"];
      const options = rawOptions.length >= 2
            ? rawOptions.slice(0, 20)
                  : ["application", "service", "ingress", "storage", "database"];

      try {
            const result = await application.client.decide(state, {
                  subsystem: {
                        type: "choice",
                        instructions: question,
                        criteria: Object.fromEntries(options.map((option) => [option, null])),
                              },
                        }, { caller: "dashboard-test" });
            return json(c, {
                  success: true,
                  data: {
                        ok: true,
                        durationMs: result.durationMs,
                        model: result.model,
                        usage: result.usage ?? null,
                        raw: result.response,
                              },
                        });
                 } catch (error) {
            const { jevErrorPayload } = await import("@jevai/jev-client");
            const payload = jevErrorPayload(error, "integration-test");
            return json(c, { success: false, data: payload }, 502);
                 }
           });

   routes.post("/integrations/test-mcp", (c) => {
      const application = app(c);
      const settings = application.getSettings();
      const mcpUrl = mcpUrlFromSettings(settings);
      return json(c, {
         success: true,
         data: {
               mcpUrl,
               mcpEnabled: settings.mcp.enabled,
               endpoint: `${mcpUrl}/mcp`,
               instructionsUrl: `${mcpUrl}/mcp`,
               note: "MCP is served by this application on the configured MCP URL.",
                  },
              });
           });

   return routes;
}

function zipResponse(
   files: Array<{ path: string; content: string }>,
   zipName: string,
): Response {
   const entries: Record<string, Uint8Array> = {};
   for (const file of files) entries[file.path] = strToU8(file.content);
   const zipped = zipSync(entries);
   return new Response(zipped, {
      headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${zipName}"`,
               },
           });
}

export { GUIDE_IDS };
