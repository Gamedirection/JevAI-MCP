import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AppContext } from "./context.ts";
import { createApiApp } from "./api.ts";
import { createMcpSessionManager } from "./mcp-server.ts";

const REAL_FETCH = globalThis.fetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
   return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
          });
}

const JEV_ANSWER_BODY = {
   model: "jev-1.13.0",
   answers: {
      task_type: {
         type: "choice",
         choice: "bug",
         confidence: 0.93,
         probabilities: { bug: 0.93, feature: 0.07 },
              },
      complexity: { type: "score", score: 1, confidence: 0.7 },
      escalate: { type: "noul", noul: 0.31 },
      strategy: { type: "choice", choice: "ingress", confidence: 0.66 },
      subsystem: { type: "choice", choice: "ingress", confidence: 0.88 },
      rating: { type: "score", score: 2, confidence: 0.8 },
      statement: { type: "noul", noul: 0.4 },
      topic: { type: "choice", choice: "billing", confidence: 0.9 },
   },
   usage: { input_tokens: 421, output_tokens: 0 },
};

let jevMode: "ok" | "fail" = "ok";

function mockedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
   const url = String(input);
   if (url.includes("/systemone")) {
      if (jevMode === "fail") return Promise.resolve(jsonResponse({ error: "upstream unavailable" }, 503));
      return Promise.resolve(jsonResponse(JEV_ANSWER_BODY));
         }
   if (url.startsWith("http://127.0.0.1")) {
      return REAL_FETCH(input as string, init);
         }
   return Promise.resolve(jsonResponse({ error: "not mocked" }, 404));
}

let context: AppContext;
let mcpManager: Awaited<ReturnType<typeof createMcpSessionManager>>;
let server: Server;
let base: string;

beforeAll(async () => {
   jevMode = "ok";
   globalThis.fetch = mockedFetch as unknown as typeof fetch;

   context = AppContext.create({
      DATABASE_PATH: ":memory:",
      DEFAPI_API_KEY: "dk-test-integration-key-123456",
      JEV_MODEL: "typesafe/jev-1.13",
      LOG_LEVEL: "error",
      JEV_RETRIES: "0",
         });

   mcpManager = await createMcpSessionManager(context);
   const apiApp = createApiApp(context, mcpManager);

   server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
         const headers = new Headers();
         for (const [key, value] of Object.entries(req.headers)) {
               if (Array.isArray(value)) for (const entry of value) headers.append(key, entry);
               else if (value !== undefined) headers.set(key, value);
                  }
         const method = req.method ?? "GET";
         const raw = new Request(`http://127.0.0.1:${(server.address() as { port: number }).port}${req.url ?? "/"}`, {
               method,
               headers,
               body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
                  });
         void Promise.resolve(apiApp.fetch(raw)).then((response: Response) => {
               res.statusCode = response.status;
               response.headers.forEach((value: string, key: string) => {
                     if (key.toLowerCase() !== "content-encoding") res.setHeader(key, value);
                         });
               void response.arrayBuffer().then((buffer: ArrayBuffer) => res.end(Buffer.from(buffer)));
                       	});
            });
         });

   await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
   const address = server.address();
   if (!address || typeof address === "string") throw new Error("failed to bind test server");
   base = `http://127.0.0.1:${address.port}`;
      });

afterAll(async () => {
   await mcpManager?.close().catch(() => undefined);
   await new Promise<void>((resolve) => {
      server?.closeAllConnections?.();
      server?.close(() => resolve());
         });
   context?.close();
   globalThis.fetch = REAL_FETCH;
      });

async function get(path: string): Promise<{ status: number; body: unknown }> {
   const response = await REAL_FETCH(`${base}${path}`);
   const text = await response.text();
   let body: unknown;
   try {
      body = JSON.parse(text);
          } catch {
      body = text;
          }
   return { status: response.status, body };
}

describe("health endpoints", () => {
   it("GET /health returns a status payload", async () => {
      const { status, body } = await get("/health");
      expect(status).toBe(200);
      expect(["healthy", "degraded", "unhealthy"]).toContain((body as { status: string }).status);
      expect((body as { database: string }).database).toBe("healthy");
      expect((body as { mcp: string }).mcp).toBe("running");
          });

   it("GET /health/live returns alive", async () => {
      const { status, body } = await get("/health/live");
      expect(status).toBe(200);
      expect((body as { status: string }).status).toBe("alive");
          });

   it("GET /health/ready returns ready when the database is healthy", async () => {
      const { status, body } = await get("/health/ready");
      expect(status).toBe(200);
      expect((body as { status: string }).status).toBe("ready");
          });

   it("keeps serving health when DefAPI is down (fail open)", async () => {
      jevMode = "fail";
      const failed = await REAL_FETCH(`${base}/api/system/test-jev-connection`, { method: "POST" });
      expect(failed.status).toBe(502);
      const { status, body } = await get("/health");
      expect(status).toBe(200);
      expect((body as { jev: string }).jev).toBe("disconnected");
      jevMode = "ok";
          });
});

describe("api bootstrap and settings", () => {
   it("GET /api/bootstrap never exposes secrets", async () => {
      const { status, body } = await get("/api/bootstrap");
      expect(status).toBe(200);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("dk-test-integration-key");
      expect((body as { data: { apiKeySource: string } }).data.apiKeySource).toBe("environment");
          });

   it("GET /api/settings shows masked key and source", async () => {
      const { body } = await get("/api/settings");
      const data = (body as { data: Record<string, unknown> }).data;
      expect(JSON.stringify(body)).not.toContain("dk-test-integration-key-123456");
      expect(data.apiKeySource).toBe("environment");
      expect(data.apiKeyMasked).toContain("*");
          });

   it("PUT /api/settings updates the model", async () => {
       const response = await REAL_FETCH(`${base}/api/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { jev: { model: "jev-1.13.0" } } }),
              	});
       const debugText = await response.clone().text();
       expect(response.status, debugText).toBe(200);
      const body = (await response.json()) as { data: { settings: { jev: { model: string } } } };
      expect(body.data.settings.jev.model).toBe("jev-1.13.0");
         });

   it("rejects invalid settings payloads", async () => {
      const response = await REAL_FETCH(`${base}/api/settings`, {
         method: "PUT",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ settings: { jev: { retries: 999 } } }),
            });
      expect(response.status).toBe(422);
         });

   it("POST /api/settings/api-key is refused while the env key is active", async () => {
      const response = await REAL_FETCH(`${base}/api/settings/api-key`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ apiKey: "dk-another-key-1234567890" }),
            });
      expect(response.status).toBe(409);
         });

   it("rejects invalid JSON bodies with 400", async () => {
      const response = await REAL_FETCH(`${base}/api/settings`, {
         method: "PUT",
         headers: { "Content-Type": "application/json" },
         body: "this is not json",
            });
      expect(response.status).toBe(400);
         });
});

describe("dashboard, requests, agents, logs", () => {
   it("GET /api/dashboard returns aggregates", async () => {
      const { status, body } = await get("/api/dashboard?range=7d");
      expect(status).toBe(200);
      const data = (body as { data: Record<string, unknown> }).data;
      expect(data).toHaveProperty("summary");
      expect(Array.isArray((data as { timeline: unknown }).timeline)).toBe(true);
          });

   it("GET /api/dashboard supports custom from/to", async () => {
      const from = new Date(Date.now() - 3_600_000).toISOString();
      const to = new Date().toISOString();
      const { status } = await get(`/api/dashboard?range=custom&from=${from}&to=${to}`);
      expect(status).toBe(200);
          });

   it("GET /api/agents includes zeroed known agents", async () => {
      const { body } = await get("/api/agents");
      const agents = (body as { data: Array<{ caller: string }> }).data;
      const callers = agents.map((agent) => agent.caller);
      expect(callers).toEqual(
            expect.arrayContaining(["codex", "claude-code", "opencode", "gemini", "unknown", "generic"]),
               );
          });

   it("GET /api/logs returns records with maxId", async () => {
      const { status, body } = await get("/api/logs?limit=10");
      expect(status).toBe(200);
      const data = (body as { data: Record<string, unknown> }).data;
      expect(data).toHaveProperty("records");
      expect(data).toHaveProperty("maxId");
          });

   it("downloads logs in text and JSON formats", async () => {
      for (const format of ["text", "json"]) {
         const response = await REAL_FETCH(`${base}/api/logs/download?format=${format}`);
         expect(response.status).toBe(200);
         expect(response.headers.get("Content-Disposition")).toContain(format === "text" ? ".txt" : ".json");
             }
          });
});

describe("integrations", () => {
   it("lists all five integration guides with the dynamic MCP url", async () => {
      const { status, body } = await get("/api/integrations");
      expect(status).toBe(200);
      const data = (body as { data: { guides: unknown[]; mcpUrl: string } }).data;
      expect(data.guides).toHaveLength(5);
      expect(data.mcpUrl).toMatch(/^https?:\/\//);
          });

   it("downloads per-agent and combined ZIPs", async () => {
      for (const id of ["codex", "claude", "opencode", "gemini", "generic"]) {
         const response = await REAL_FETCH(`${base}/api/integrations/${id}/download`);
         expect(response.status).toBe(200);
         expect(response.headers.get("Content-Type")).toBe("application/zip");
             }
      const all = await REAL_FETCH(`${base}/api/integrations/download-all`);
      expect(all.status).toBe(200);
      expect(all.headers.get("Content-Type")).toBe("application/zip");
          });

   it("runs the example decision end to end", async () => {
      jevMode = "ok";
      const response = await REAL_FETCH(`${base}/api/integrations/test-decision`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({}),
            });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { ok: boolean; raw: { answers: Record<string, unknown> } } };
      expect(body.data.ok).toBe(true);
      expect(body.data.raw.answers.subsystem).toBeDefined();
          });

   it("reports JEV_UNAVAILABLE from the connection test when upstream fails", async () => {
      jevMode = "fail";
      const response = await REAL_FETCH(`${base}/api/system/test-jev-connection`, { method: "POST" });
      expect(response.status).toBe(502);
      const body = (await response.json()) as { data: { ok: boolean; error?: { type: string } } };
      expect(body.data.ok).toBe(false);
      expect(body.data.error?.type).toBe("JEV_UNAVAILABLE");
      jevMode = "ok";
          });

   it("never leaks the API key in diagnostics bundles", async () => {
      const response = await REAL_FETCH(`${base}/api/system/diagnostics?format=json`);
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(text).not.toContain("dk-test-integration-key-123456");
          });
});

describe("metrics endpoint", () => {
   it("renders prometheus text without high-cardinality labels", async () => {
      const { status, body } = await get("/metrics");
      expect(status).toBe(200);
      const text = String(body);
      expect(text).toContain("# TYPE jevai_requests_total counter");
      expect(text).toContain("jevai_http_duration_seconds_bucket");
      expect(text).not.toMatch(/request_id=/);
      expect(text).not.toMatch(/session_id=/);
      expect(text).not.toMatch(/repository=/);
           });
});

describe("MCP over HTTP", () => {
   async function connectClient(name: string, headers?: Record<string, string>): Promise<Client> {
      const client = new Client({ name, version: "0.0.1" });
      const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
         requestInit: headers ? { headers } : undefined,
            });
      await client.connect(transport);
      return client;
         }

   it("exposes the five tools through tools/list", async () => {
      const client = await connectClient("harness-a");
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
             "jev_assess_complexity",
            "jev_choose_strategy",
            "jev_decide",
            "jev_route_task",
            "jev_should_escalate",
               ]);
      for (const tool of tools.tools) {
         expect((tool.description ?? "").length).toBeGreaterThan(50);
         expect(tool.inputSchema).toBeDefined();
             }
      await client.close();
         });

   it("serves jev_decide with batched answers", async () => {
      jevMode = "ok";
      const client = await connectClient("harness-b");
      const call = await client.callTool({
         name: "jev_decide",
         arguments: {
               state: "HTTP 502 through ingress after rollout",
               questions: {
                     task_type: { type: "choice", instructions: "Task type?", criteria: { bug: "defect" } },
                     escalate: { type: "noul", instructions: "Escalate?" },
                        },
               caller: { caller: "codex", project: "shop", session_id: "sess-1" },
                  },
            });
      const payload = call.structuredContent as {
         success: boolean;
         answers: Record<string, { choice?: string; guidance?: string; verdict?: string }>;
         usage?: { input_tokens?: number };
            };
      expect(payload.success).toBe(true);
      expect(payload.answers.task_type?.choice).toBe("bug");
      expect(payload.answers.task_type?.guidance).toBe("use");
      expect(payload.answers.escalate?.verdict).toBe("agent_decides");
      expect(payload.usage?.input_tokens).toBe(421);
      await client.close();
         });

   it("shows fail-open errors to the calling agent", async () => {
      jevMode = "fail";
      const client = await connectClient("harness-c");
      const call = await client.callTool({
         name: "jev_should_escalate",
         arguments: { state: "drop a production table", caller: { caller: "opencode" } },
            });
      expect(call.isError).toBe(true);
      const payload = call.structuredContent as {
         success: boolean;
         error: { type: string; retryable: boolean; message: string };
            };
      expect(payload.success).toBe(false);
      expect(payload.error.type).toBe("JEV_UNAVAILABLE");
      expect(payload.error.retryable).toBe(true);
      expect(payload.error.message).toContain("Continue using your normal reasoning");
      await client.close();
      jevMode = "ok";
         });

   it("rejects requests with unknown session ids", async () => {
      const response = await REAL_FETCH(`${base}/mcp`, {
         method: "POST",
         headers: {
               "Content-Type": "application/json",
               Accept: "application/json, text/event-stream",
               "mcp-session-id": "does-not-exist",
                  },
         body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
            });
      expect(response.status).toBe(404);
         });
});

describe("request recording", () => {
   it("persists MCP calls with caller metadata and token usage", async () => {
      const response = await REAL_FETCH(`${base}/api/requests?caller=codex`);
      const body = (await response.json()) as {
         data: { records: Array<{ tool: string; inputTokens: number | null; status: string }> };
            };
      const record = body.data.records.find((entry) => entry.tool === "jev_decide");
      expect(record).toBeDefined();
      expect(record?.inputTokens).toBe(421);
      expect(record?.status).toBe("success");
         });

   it("honours metadata-only privacy: detail never returns state body by default", async () => {
      const listResponse = await REAL_FETCH(`${base}/api/requests`);
      const listBody = (await listResponse.json()) as {
         data: { records: Array<{ id: number }> };
            };
      const first = listBody.data.records[0];
      expect(first).toBeDefined();
      const detailResponse = await REAL_FETCH(`${base}/api/requests/${first!.id}`);
      const detail = (await detailResponse.json()) as {
         data: { state: unknown; contentPolicy: { requestState: string } };
            };
      expect(detail.data.state).toBeNull();
      expect(detail.data.contentPolicy.requestState).toBe("metadata_only");
         });
});

describe("security headers", () => {
   it("adds hardening headers", async () => {
      const response = await REAL_FETCH(`${base}/api/bootstrap`);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
         });
});
