import { describe, expect, it, vi } from "vitest";
import {
   collectingRecorder,
   handleToolCall,
   listToolDefinitions,
   type ToolDeps,
} from "./tools.ts";
type QuestionMap = Record<string, unknown>;

type ChoiceLike = { choice?: string; score?: number; noul?: number; guidance?: string; verdict?: string };

const asChoice = (
   answers: Record<string, ChoiceLike> | undefined,
   key: string,
): ChoiceLike => (answers?.[key] ?? {}) as ChoiceLike;

interface FakeCall {
   state: unknown;
   questions: QuestionMap;
   options?: { requestId?: string; caller?: string };
}

function fakeDecider(behavior: (call: FakeCall) => Promise<unknown>) {
   const calls: FakeCall[] = [];
   const client = {
      async decide(state: unknown, questions: QuestionMap, options?: FakeCall["options"]) {
         const call = { state, questions, options };
         calls.push(call);
         const body = await behavior(call);
         return {
            response: body,
            durationMs: 42,
            model: (body as { model: string }).model,
            usage: (body as { usage?: { input_tokens: number } }).usage,
            requestId: options?.requestId ?? "r",
            attempts: 1,
             };
           },
       } as unknown as ToolDeps["client"];
   return { client, calls };
}

const okBody = (answers: unknown) => ({
   model: "jev-1.13.0",
   answers,
   usage: { input_tokens: 321, output_tokens: 0 },
});

const depsFor = (
   client: ToolDeps["client"],
   privacy: ToolDeps["privacy"] = () => ({ requestState: "metadata_only", storeResponses: true }),
) => {
   const recorder = collectingRecorder();
   return { deps: { client, recorder, privacy } satisfies ToolDeps, recorder };
};

describe("listToolDefinitions", () => {
   it("exposes the five tools with JSON schemas", () => {
      const tools = listToolDefinitions();
      expect(tools.map((t) => t.name)).toEqual([
         "jev_decide",
          "jev_route_task",
         "jev_assess_complexity",
         "jev_should_escalate",
         "jev_choose_strategy",
            ]);
      for (const tool of tools) {
         const schema = tool.inputSchema as { type?: string };
         expect(["object", "any", "union"].includes(schema.type ?? "object")).toBe(true);
            }
         });
});

describe("jev_decide", () => {
   it("batches multiple questions in one Jev call", async () => {
      const { client, calls } = fakeDecider(async () =>
         okBody({
            task_type: { type: "choice", choice: "bug", confidence: 0.91 },
            complexity: { type: "score", score: 1, confidence: 0.8 },
            escalate: { type: "noul", noul: 0.1 },
               }),
         );
      const { deps, recorder } = depsFor(client);

      const result = await handleToolCall(
         "jev_decide",
          {
            state: "checkout throws null pointer after 14:02 deploy",
            questions: {
               task_type: { type: "choice", instructions: "Task type?", criteria: { bug: "defect" } },
               complexity: { type: "score", instructions: "Complexity?", criteria: ["tiny", "huge"] },
               escalate: { type: "noul", instructions: "Escalate?" },
                  },
            caller: { caller: "codex", project: "shop" },
               },
         deps,
         );

      expect(result.isError).toBe(false);
      expect(calls).toHaveLength(1);
      expect(asChoice(result.payload.answers, "task_type").guidance).toBe("use");
      expect(recorder.entries[0]?.questionCount).toBe(3);
      expect(recorder.entries[0]?.caller).toBe("codex");
      expect(recorder.entries[0]?.stateJson).toBeNull();
      expect(recorder.entries[0]?.responseJson).toContain("task_type");
         });

   it("stores full state only when privacy allows", async () => {
      const { client } = fakeDecider(async () => okBody({ q: { type: "noul", noul: 0.5 } }));
      const full = depsFor(client, () => ({ requestState: "full", storeResponses: true }));
      await handleToolCall(
         "jev_decide",
          { state: "secret source code here", questions: { q: { type: "noul", instructions: "?" } } },
         full.deps,
         );
      expect(full.recorder.entries[0]?.stateJson).toContain("secret source code");

      const { client: client2 } = fakeDecider(async () => okBody({ q: { type: "noul", noul: 0.5 } }));
      const off = depsFor(client2, () => ({ requestState: "off", storeResponses: false }));
      await handleToolCall(
         "jev_decide",
          { state: "secret source code here", questions: { q: { type: "noul", instructions: "?" } } },
         off.deps,
         );
      expect(off.recorder.entries[0]?.stateJson).toBeNull();
      expect(off.recorder.entries[0]?.responseJson).toBeNull();
      expect(off.recorder.entries[0]?.stateSizeChars).toBeGreaterThan(0);
         });

   it("validates unknown question types before any Jev call", async () => {
      const { client, calls } = fakeDecider(async () => okBody({}));
      const { deps } = depsFor(client);
      const result = await handleToolCall(
         "jev_decide",
          { state: "s", questions: { q: { type: "guess", instructions: "nope" } } },
         deps,
         );
      expect(result.isError).toBe(true);
      expect(calls).toHaveLength(0);
      expect(recorderError(result)?.type).toBe("VALIDATION_ERROR");
         });
});

function recorderError(result: { payload: { error?: unknown } }) {
   return result.payload.error as { type: string; message: string; retryable: boolean } | undefined;
}

describe("jev_route_task", () => {
   it("uses default task categories and marks guidance levels", async () => {
      const { client } = fakeDecider(async (call) => {
         const criteria = Object.keys(
               (call.questions.task_type as { criteria: Record<string, string | null> }).criteria,
               );
         expect(criteria).toContain("documentation");
         return okBody({ task_type: { type: "choice", choice: "documentation", confidence: 0.65 } });
            });
      const { deps } = depsFor(client);
      const result = await handleToolCall("jev_route_task", { state: "add a README" }, deps);
      expect(asChoice(result.payload.answers, "task_type").choice).toBe("documentation");
      expect(asChoice(result.payload.answers, "task_type").guidance).toBe("guidance");
         });

   it("accepts custom choices", async () => {
      const { client } = fakeDecider(async (call) => {
         const criteria = Object.keys(
               (call.questions.task_type as { criteria: Record<string, string | null> }).criteria,
               );
         expect(criteria).toEqual(["k8s", "vm"]);
         return okBody({ task_type: { type: "choice", choice: "k8s", confidence: 0.9 } });
            });
      const { deps } = depsFor(client);
      const result = await handleToolCall(
         "jev_route_task",
          { state: "node not ready", choices: { k8s: "kubernetes node", vm: "virtual machine" } },
         deps,
         );
      expect(result.payload.success).toBe(true);
         });
});

describe("jev_assess_complexity", () => {
   it("asks the ordered five-level scale", async () => {
      const { client } = fakeDecider(async (call) => {
         const criteria = (call.questions.complexity as { criteria: string[] }).criteria;
         expect(criteria).toHaveLength(5);
         return okBody({
               complexity: {
                     type: "score",
                     score: 3,
                     confidence: 0.88,
                     legend: { "3": "architecture decisions" },
                        },
                     });
            });
      const { deps } = depsFor(client);
      const result = await handleToolCall("jev_assess_complexity", { state: "rewrite billing" }, deps);
      expect(asChoice(result.payload.answers, "complexity").score).toBe(3);
      expect(asChoice(result.payload.answers, "complexity").guidance).toBe("use");
         });
});

describe("jev_should_escalate", () => {
   it("returns verdict bands based on the noul probability", async () => {
      const cases = [
         { noul: 0.93, verdict: "strong_yes" },
         { noul: 0.05, verdict: "strong_no" },
         { noul: 0.5, verdict: "agent_decides" },
            ] as const;
      for (const testCase of cases) {
         const { client } = fakeDecider(async () =>
               okBody({ escalate: { type: "noul", noul: testCase.noul } }),
               );
         const { deps } = depsFor(client);
         const result = await handleToolCall("jev_should_escalate", { state: "db migration" }, deps);
         expect(asChoice(result.payload.answers, "escalate").verdict).toBe(testCase.verdict);
            }
         });
});

describe("jev_choose_strategy", () => {
   it("requires at least two strategies", async () => {
      const { client, calls } = fakeDecider(async () => okBody({}));
      const { deps } = depsFor(client);
      const result = await handleToolCall(
         "jev_choose_strategy",
          { state: "502", strategies: { logs: "read logs" } },
         deps,
         );
      expect(result.isError).toBe(true);
      expect(calls).toHaveLength(0);
      expect(recorderError(result)?.message).toContain("at least two");
         });

   it("builds a choice question from strategies", async () => {
      const { client, calls } = fakeDecider(async (call) => {
         const criteria = (call.questions.strategy as { criteria: Record<string, string> }).criteria;
         expect(Object.keys(criteria)).toEqual(["inspect_logs", "inspect_database"]);
         return okBody({ strategy: { type: "choice", choice: "inspect_logs", confidence: 0.81 } });
            });
      const { deps } = depsFor(client);
      const result = await handleToolCall(
         "jev_choose_strategy",
          {
            state: "502 through ingress",
            strategies: { inspect_logs: "container logs", inspect_database: "db health" },
            caller: { caller: "claude-code" },
               },
         deps,
         );
      expect(calls[0]?.options?.caller).toBe("claude-code");
      expect(asChoice(result.payload.answers, "strategy").guidance).toBe("use");
         });
});

describe("failure paths", () => {
   it("returns structured fail-open errors when Jev is unavailable", async () => {
      const { JevClientError } = await import("@jevai/jev-client");
      const { client } = fakeDecider(async () => {
         throw new JevClientError(
               "Jev API is temporarily unavailable.",
                { category: "JEV_UNAVAILABLE", retryable: true, statusCode: 503, attempts: 3 },
               "req-1",
               );
            });
      const { deps, recorder } = depsFor(client);
      const result = await handleToolCall("jev_route_task", { state: "anything" }, deps);
      expect(result.isError).toBe(true);
      expect(result.payload.error).toMatchObject({
            type: "JEV_UNAVAILABLE",
            retryable: true,
            status_code: 503,
               });
      expect(result.payload.error?.message).toContain("Continue using your normal reasoning");
      expect(recorder.entries[0]?.status).toBe("error");
      expect(recorder.entries[0]?.errorCategory).toBe("JEV_UNAVAILABLE");
         });

   it("rejects unknown tools", async () => {
      const { client } = fakeDecider(async () => okBody({}));
      const { deps, recorder } = depsFor(client);
      const result = await handleToolCall("jev_laser", { state: "x" }, deps);
      expect(result.isError).toBe(true);
      expect(recorder.entries[0]?.errorCategory).toBe("VALIDATION_ERROR");
         });

   it("rejects an empty state", async () => {
      const { client } = fakeDecider(async () => okBody({}));
      const { deps } = depsFor(client);
      const result = await handleToolCall("jev_assess_complexity", {}, deps);
      expect(result.isError).toBe(true);
      expect(recorderError(result)?.type).toBe("VALIDATION_ERROR");
         });
});

it("sends caller metadata in request headers context to the client", async () => {
   const { client, calls } = fakeDecider(async () =>
         okBody({ escalate: { type: "noul", noul: 0.3 } }),
         );
   const { deps } = depsFor(client);
   const result = await handleToolCall(
         "jev_should_escalate",
          {
            state: "s",
            caller: {
                  caller: "gemini",
                  client_version: "0.30.1",
                  repository: "acme/api",
                  session_id: "sess-9",
                     },
                  },
         deps,
         );
   expect(calls[0]?.options?.caller).toBe("gemini");
   const record = result.record;
   expect(record.clientVersion).toBe("0.30.1");
   expect(record.repository).toBe("acme/api");
   expect(record.sessionId).toBe("sess-9");
      });

describe("fallback chain", () => {
   const failing = async (category: "JEV_UNAVAILABLE" | "JEV_BAD_REQUEST" = "JEV_UNAVAILABLE") => {
      const { client } = fakeDecider(async () => {
         const { JevClientError } = await import("@jevai/jev-client");
         throw new JevClientError(
            "upstream is down",
            { category, retryable: true, statusCode: 503, attempts: 4 },
            "req-1",
         );
            });
      return client;
      };

   const fallbackReturning = (answers: Record<string, unknown>) => () =>
      Promise.resolve({
         decision: {
            source: "local_llm" as const,
            durationMs: 120,
            response: { model: "qwen3.5:122b", answers: answers as never },
            usage: { input_tokens: 20, output_tokens: 8 },
         },
         attempts: [],
            });

   it("answers from the fallback and tags the source", async () => {
      const { deps, recorder } = depsFor(await failing());
      const result = await handleToolCall(
         "jev_should_escalate",
         { state: "prod is down" },
         { ...deps, fallback: fallbackReturning({ escalate: { type: "noul", noul: 0.9 } }) },
         );

      expect(result.isError).toBe(false);
      expect(result.payload.source).toBe("local_llm");
      expect(result.payload.model).toBe("qwen3.5:122b");
      expect(result.payload.answers?.escalate).toEqual({ type: "noul", noul: 0.9 });
      expect(recorder.entries[0]?.status).toBe("success");
   });

   it("keeps the original Jev failure visible in the payload", async () => {
      const { deps } = depsFor(await failing("JEV_BAD_REQUEST"));
      const result = await handleToolCall(
         "jev_should_escalate",
         { state: "x" },
         { ...deps, fallback: fallbackReturning({ escalate: { type: "noul", noul: 0.5 } }) },
         );

      expect(result.payload.jev_error?.type).toBe("JEV_BAD_REQUEST");
      expect(result.payload.jev_error?.status_code).toBe(503);
   });

   it("never attaches guidance to an uncalibrated answer", async () => {
      const { deps } = depsFor(await failing());
      const result = await handleToolCall(
         "jev_should_escalate",
         { state: "x" },
         { ...deps, fallback: fallbackReturning({ escalate: { type: "noul", noul: 0.99 } }) },
         );

      const answer = result.payload.answers?.escalate as Record<string, unknown>;
      expect(answer).not.toHaveProperty("confidence");
      expect(answer).not.toHaveProperty("guidance");
      expect(answer).not.toHaveProperty("verdict");
   });

   it("records the fallback in the request log so outages stay visible", async () => {
      const { deps, recorder } = depsFor(await failing());
      await handleToolCall(
         "jev_should_escalate",
         { state: "x" },
         { ...deps, fallback: fallbackReturning({ escalate: { type: "noul", noul: 0.5 } }) },
         );

      expect(recorder.entries[0]?.errorCategory).toBe("JEV_UNAVAILABLE");
      expect(recorder.entries[0]?.errorMessage).toContain("fallback:local_llm");
   });

   it("falls back on a 404 too, since the operator asked for every error", async () => {
      const { deps } = depsFor(await failing("JEV_BAD_REQUEST"));
      const result = await handleToolCall(
         "jev_should_escalate",
         { state: "x" },
         { ...deps, fallback: fallbackReturning({ escalate: { type: "noul", noul: 0.5 } }) },
         );
      expect(result.payload.source).toBe("local_llm");
   });

   it("returns the fail-open error when the fallback also fails", async () => {
      const { deps, recorder } = depsFor(await failing());
      const result = await handleToolCall(
         "jev_should_escalate",
         { state: "x" },
         {
            ...deps,
            fallback: () => Promise.reject(new Error("local and cloud both down")),
         },
         );

      expect(result.isError).toBe(true);
      expect(result.payload.error?.message).toContain("Fallback also failed");
      expect(recorder.entries[0]?.status).toBe("error");
   });

   it("does not call the fallback when Jev succeeds", async () => {
      const { client } = fakeDecider(async () =>
         okBody({ escalate: { type: "noul", noul: 0.2, confidence: 0.95 } }),
         );
      const { deps } = depsFor(client);
      const fallback = vi.fn();
      const result = await handleToolCall("jev_should_escalate", { state: "x" }, { ...deps, fallback });

      expect(fallback).not.toHaveBeenCalled();
      expect(result.payload.source).toBeUndefined();
      expect(result.payload.jev_error).toBeUndefined();
   });
});
