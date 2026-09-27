import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
   DEFAULT_CONFIDENCE_THRESHOLDS,
   SERVER_INSTRUCTIONS,
   normalizeCaller,
   type CallerMeta,
} from "@jevai/shared";
import {
   handleToolCall,
   toolDefinitions,
   type ToolCallRecord,
   type ToolRecorder,
} from "@jevai/mcp-tools";
import { buildFallbackDeps } from "./fallback.ts";
import type { AppContext } from "./context.ts";

const MCP_MAX_BODY_BYTES = 2_000_000;

function buildRecorder(application: AppContext): ToolRecorder {
   return {
      record(request: ToolCallRecord) {
         try {
                application.db.requests.insert({
                     requestId: request.requestId,
                     timestamp: request.timestamp,
                     caller: request.caller,
                     tool: request.tool,
                     model: request.model,
                     durationMs: request.durationMs,
                     inputTokens: request.inputTokens,
                     outputTokens: request.outputTokens,
                     status: request.status,
                     errorCategory: request.errorCategory,
                     errorMessage: request.errorMessage,
                     clientVersion: request.clientVersion,
                     project: request.project,
                     repository: request.repository,
                     sessionId: request.sessionId,
                     questionCount: request.questionCount,
                     stateSizeChars: request.stateSizeChars,
                     stateJson: request.stateJson,
                     responseJson: request.responseJson,
                          });
                application.metrics.requestsTotal.inc(1, {
                     caller: request.caller,
                     tool: request.tool,
                          });
                if (request.status === "success") {
                     application.metrics.requestsSuccessTotal.inc(1, {
                           caller: request.caller,
                           tool: request.tool,
                                });
                     application.metrics.requestDuration.observe(
                           request.durationMs / 1000,
                           { caller: request.caller, tool: request.tool },
                                );
                     if (request.inputTokens && request.inputTokens > 0) {
                           application.metrics.inputTokensTotal.inc(request.inputTokens, {
                                 caller: request.caller,
                                 tool: request.tool,
                                   });
                           }
                        } else {
                     application.metrics.requestsFailedTotal.inc(1, {
                           caller: request.caller,
                           tool: request.tool,
                           category: request.errorCategory ?? "INTERNAL_ERROR",
                                });
                     }
                application.logs.sink?.flush();
                  } catch (error) {
                application.log("mcp").error("failed to persist MCP request", {
                     error: error instanceof Error ? error.message : String(error),
                     requestId: request.requestId,
                          });
                  }
               },
          };
}

export function createMcpServer(application: AppContext, callerHint?: string): McpServer {
   const server = new McpServer(
      {
         name: "jevai-mcp",
         title: "JevAI-MCP",
         version: application.versionInfo.version,
         description: "Fast typed decisions from the Jev decision model.",
         websiteUrl: undefined,
         icons: undefined,
           },
       { instructions: SERVER_INSTRUCTIONS },
        );

   const recorder = buildRecorder(application);
   const fallbackDeps = buildFallbackDeps(application);
   const deps = {
      client: application.client,
      recorder,
      privacy: () => {
         const settings = application.getSettings().storage;
         return {
               requestState: settings.requestState,
               storeResponses: settings.storeResponses,
                    };
                 },
      thresholds: () => ({ ...DEFAULT_CONFIDENCE_THRESHOLDS }),
      ...(fallbackDeps ?? {}),
        };

   const effectiveCallerHint = callerHint;

   for (const definition of toolDefinitions) {
      server.registerTool(
         definition.name,
          {
            description: definition.description,
            inputSchema: schemaShape(definition.name),
            annotations: {
                  readOnlyHint: true,
                  destructiveHint: false,
                  idempotentHint: true,
                  openWorldHint: true,
                    },
                },
         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         async (args: any) => {
            const withHint = ensureCallerHint(args, effectiveCallerHint);
            const result = await handleToolCall(definition.name, withHint, deps);
            const text = JSON.stringify(result.payload, null, 2);
            return {
                  content: [{ type: "text" as const, text }],
                  structuredContent: result.payload as unknown as Record<string, unknown>,
                  isError: result.isError,
                       };
                 },
          );
        }

   return server;
}

// The SDK wants a Zod raw shape. We reuse our zod v4 objects' shape directly.
function schemaShape(toolName: string): Record<string, never> {
   const definition = toolDefinitions.find((entry) => entry.name === toolName);
   const schema = definition?.inputSchema as unknown as {
      shape?: Record<string, unknown> | (() => Record<string, unknown>);
        };
   const shape = typeof schema?.shape === "function" ? schema.shape() : schema?.shape;
   return (shape ?? {}) as Record<string, never>;
}

function ensureCallerHint(
   args: Record<string, unknown>,
   hint: string | undefined,
): Record<string, unknown> {
   if (!hint) return args;
   const existing = (args.caller ?? {}) as CallerMeta;
   if (existing.caller) return args;
   return { ...args, caller: { ...existing, caller: normalizeCaller(hint) } };
}

export interface McpSessionManager {
   handleRequest(request: Request): Promise<Response>;
   close(): Promise<void>;
   sessionCount(): number;
}

export async function createMcpSessionManager(
   application: AppContext,
   callerHint?: string,
): Promise<McpSessionManager> {
   const sessions = new Map<string, { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }>();

   const manager: McpSessionManager = {
      async handleRequest(request) {
         const sessionId = request.headers.get("mcp-session-id") ?? undefined;
         const isInitialize = await looksLikeInitialize(request);

         if (isInitialize) {
               const server = createMcpServer(application, callerHintFrom(request, callerHint));
               const transport = new WebStandardStreamableHTTPServerTransport({
                     sessionIdGenerator: () => randomUUID(),
                     enableJsonResponse: true,
                     maxRequestBodySize: MCP_MAX_BODY_BYTES,
                     onsessioninitialized: (id) => {
                           sessions.set(id, { server, transport });
                           application.log("mcp").info("MCP session initialized", {
                                 sessionId: id,
                                 callerHint: callerHintFrom(request, callerHint),
                                   });
                           application.metrics.registry
                                 .gauge("jevai_mcp_sessions", "Active MCP sessions.")
                                 .set(sessions.size);
                         },
                     onsessionclosed: (id) => {
                           sessions.delete(id);
                           void server.close().catch(() => undefined);
                           application.metrics.registry
                                 .gauge("jevai_mcp_sessions", "Active MCP sessions.")
                                 .set(sessions.size);
                         },
                     });
               transport.onclose = () => {
                     if (transport.sessionId) sessions.delete(transport.sessionId);
                       };
               await server.connect(transport);
               return transport.handleRequest(request);
                 }

         if (sessionId && sessions.has(sessionId)) {
               const { transport } = sessions.get(sessionId)!;
               return transport.handleRequest(request);
                 }

         if (!sessionId) {
               return new Response(
                     JSON.stringify({
                           jsonrpc: "2.0",
                           error: {
                                 code: -32000,
                                 message: "Bad Request: no mcp-session-id header present.",
                                   },
                           id: null,
                              }),
                     {
                           status: 400,
                           headers: { "Content-Type": "application/json" },
                          });
                 }

         return new Response(
               JSON.stringify({
                     jsonrpc: "2.0",
                     error: { code: -32001, message: `Session not found: ${sessionId}` },
                     id: null,
                        }),
               { status: 404, headers: { "Content-Type": "application/json" } },
                );
              },
      async close() {
         for (const { server } of sessions.values()) {
               await server.close().catch(() => undefined);
                 }
         sessions.clear();
              },
      sessionCount() {
         return sessions.size;
              },
         };

   return manager;
}

async function looksLikeInitialize(request: Request): Promise<boolean> {
   if (request.method !== "POST") return false;
   try {
      const cloned = request.clone();
      const body = (await cloned.json()) as { method?: string };
      return body.method === "initialize";
          } catch {
      return false;
          }
}

const HEADER_CALLER_MAP: Array<[string, string]> = [
   ["x-jev-caller", "custom"],
    ["user-agent", "unknown"],
];

function callerHintFrom(request: Request, fallback?: string): string | undefined {
   const explicit = request.headers.get("x-jev-caller");
   if (explicit) return normalizeCaller(explicit);
   const origin = request.headers.get("origin");
   if (origin) {
      const lowered = origin.toLowerCase();
      if (lowered.includes("codex")) return "codex";
      if (lowered.includes("claude")) return "claude-code";
      if (lowered.includes("opencode")) return "opencode";
      if (lowered.includes("gemini")) return "gemini";
        }
   const agent = request.headers.get("user-agent")?.toLowerCase() ?? "";
   if (agent.includes("codex")) return "codex";
   if (agent.includes("claude")) return "claude-code";
   if (agent.includes("opencode")) return "opencode";
   if (agent.includes("gemini")) return "gemini";
   void HEADER_CALLER_MAP;
   return fallback;
}
