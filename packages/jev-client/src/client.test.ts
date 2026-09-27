import { describe, expect, it } from "vitest";
import {
   choiceAnswerSchema,
   noulAnswerSchema,
   scoreAnswerSchema,
} from "@jevai/shared";
import { JevClient } from "./client.ts";
import { JevClientError } from "./errors.ts";
import { backoffDelayMs, isRetryableStatus, retryAfterMs } from "./retry.ts";

const successfulBody = {
   model: "jev-1.13.0",
   answers: {
      topic: {
         type: "choice",
         choice: "billing",
         confidence: 0.95,
         probabilities: { billing: 0.95, bug: 0.05 },
            },
         },
   usage: { input_tokens: 120, output_tokens: 0 },
};

function jsonResponse(
   body: unknown,
   status = 200,
   headers: Record<string, string> = {},
): Response {
   return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
         });
}

interface RecordedCall {
   url: string;
   init: RequestInit;
}

function recordingFetch(respond: (callNumber: number) => Promise<Response>) {
   const calls: RecordedCall[] = [];
   const impl = (async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return respond(calls.length);
           }) as unknown as typeof fetch;
   return {
      calls,
      impl,
      body(index = 0) {
         const init = calls[index]?.init;
         return JSON.parse(String(init?.body)) as {
               model: string;
               state: unknown;
               questions: Record<string, { type: string; criteria?: unknown }>;
                   };
                },
      header(index = 0, name: string) {
         const headers = calls[index]?.init.headers as Record<string, string> | undefined;
         return headers?.[name];
                },
         };
}

function buildClient(
   fetchImpl: typeof fetch,
   overrides: Partial<{ timeoutMs: number; retries: number; getApiKey: () => string | undefined }> = {},
) {
   return new JevClient({
      endpoint: "https://api.defapi.org/v1",
      model: "typesafe/jev-1.13",
      getApiKey: () => "dk-test-key",
      timeoutMs: 1_000,
      retries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
      fetchImpl,
         ...overrides,
            });
}

const noulQuestion = { q: { type: "noul", instructions: "ok?" } } as const;

describe("JevClient.decide", () => {
   it("posts model, state and questions to /v1/systemone with a bearer token", async () => {
      const recorder = recordingFetch(async () => jsonResponse(successfulBody));
      const client = buildClient(recorder.impl);

      const result = await client.decide("A user was charged twice.", {
         topic: {
            type: "choice",
            instructions: "What is this about?",
            criteria: { billing: "money", bug: "broken" },
               },
            });

      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0]?.url).toBe("https://api.defapi.org/v1/systemone");
      expect(recorder.calls[0]?.init.method).toBe("POST");
      expect(recorder.header(0, "Authorization")).toBe("Bearer dk-test-key");
      expect(recorder.header(0, "X-Request-Id")).toMatch(/[0-9a-f-]{36}/);
      const body = recorder.body();
      expect(body.model).toBe("typesafe/jev-1.13");
      expect(body.state).toBe("A user was charged twice.");
      expect(body.questions.topic?.type).toBe("choice");
      expect(result.model).toBe("jev-1.13.0");
      expect(result.usage?.input_tokens).toBe(120);
      expect(choiceAnswerSchema.safeParse(result.response.answers.topic).success).toBe(true);
         });

   it("reports connection transitions between connected and disconnected", async () => {
      const recorder = recordingFetch(async (n) =>
            n % 2 === 1 ? jsonResponse({ error: "upstream down" }, 503) : jsonResponse(successfulBody),
            );
      const client = buildClient(recorder.impl, { retries: 0 });
      const transitions: string[] = [];
      client.onConnectionChange((_prev, current) => transitions.push(current.state));

      await expect(client.decide("state", noulQuestion)).rejects.toBeInstanceOf(JevClientError);
      await client.decide("state", { q: { type: "noul", instructions: "ok?" } });

      expect(transitions).toEqual(["disconnected", "connected"]);
      const status = client.getConnectionStatus();
      expect(status.state).toBe("connected");
      expect(status.lastSuccessAt).not.toBeNull();
      expect(status.lastFailureAt).not.toBeNull();
         });

   it("retries 429 with Retry-After and succeeds", async () => {
      const recorder = recordingFetch(async (n) =>
            n === 1
                  ? jsonResponse({ error: "slow down" }, 429, { "Retry-After": "0" })
                  : jsonResponse(successfulBody),
               );
      const client = buildClient(recorder.impl);

      const result = await client.decide("state", {
            topic: { type: "noul", instructions: "ok?" },
               });

      expect(recorder.calls).toHaveLength(2);
      expect(result.response.answers.topic).toBeDefined();
         });

   it("does not retry HTTP 400 bad requests", async () => {
      const recorder = recordingFetch(async () => jsonResponse({ error: "bad" }, 400));
      const client = buildClient(recorder.impl);

      const error = await client.decide("state", noulQuestion).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JevClientError);
      const jevError = error as JevClientError;
      expect(jevError.category).toBe("JEV_BAD_REQUEST");
      expect(jevError.retryable).toBe(false);
      expect(recorder.calls).toHaveLength(1);
         });

   it("does not retry authentication failures", async () => {
      const recorder = recordingFetch(async () => jsonResponse({ error: "unauthorized" }, 401));
      const client = buildClient(recorder.impl);

      const error = await client.decide("state", noulQuestion).catch((e: unknown) => e);

      expect((error as JevClientError).category).toBe("JEV_AUTH_FAILURE");
      expect((error as JevClientError).retryable).toBe(false);
      expect(recorder.calls).toHaveLength(1);
         });

   it("retries 503 and eventually succeeds", async () => {
      const recorder = recordingFetch(async (n) =>
            n === 1 ? jsonResponse({ error: "upstream down" }, 503) : jsonResponse(successfulBody),
               );
      const client = buildClient(recorder.impl);

      const result = await client.decide("state", {
            topic: { type: "noul", instructions: "ok?" },
               });

      expect(recorder.calls).toHaveLength(2);
      expect(result.attempts).toBe(2);
         });

   it("gives up after exhausting retries and reports structured failure", async () => {
      const recorder = recordingFetch(async () => jsonResponse({ error: "boom" }, 503));
      const client = buildClient(recorder.impl);

      const error = (await client.decide("state", noulQuestion).catch((e: unknown) => e)) as JevClientError;

      expect(recorder.calls).toHaveLength(3);
      expect(error.category).toBe("JEV_UNAVAILABLE");
      expect(error.retryable).toBe(true);
      expect(error.attempts).toBe(3);
      expect(error.toJSON()).toEqual({
            success: false,
            error: {
                  type: "JEV_UNAVAILABLE",
                  message: expect.stringContaining("temporarily unavailable"),
                  retryable: true,
                  status_code: 503,
                  request_id: expect.any(String),
                  attempts: 3,
                        },
               });
         });

   it("classifies network-level failures as Jev unavailable", async () => {
      const recorder = recordingFetch(async () => {
            throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:443");
               });
      const client = buildClient(recorder.impl);

      const error = (await client.decide("state", noulQuestion).catch((e: unknown) => e)) as JevClientError;

      expect(error.category).toBe("JEV_UNAVAILABLE");
      expect(error.retryable).toBe(true);
      expect(recorder.calls).toHaveLength(3);
         });

   it("times out slow responses and reports JEV_TIMEOUT", async () => {
      const slowFetch = (async (_url: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
               init?.signal?.addEventListener("abort", () => {
                     const error = new Error("The operation was aborted.");
                     error.name = "AbortError";
                     reject(error);
                           });
                     })) as unknown as typeof fetch;
      const client = buildClient(slowFetch, { timeoutMs: 20, retries: 0 });

      const error = (await client.decide("state", noulQuestion).catch((e: unknown) => e)) as JevClientError;

      expect(error.category).toBe("JEV_TIMEOUT");
      expect(error.retryable).toBe(true);
         });

   it("rejects responses that do not match the Jev schema", async () => {
      const recorder = recordingFetch(async () =>
            jsonResponse({ model: "jev-1.13.0", answers: { q: { type: "noul", noul: 42 } } }),
               );
      const client = buildClient(recorder.impl, { retries: 0 });

      const error = (await client.decide("state", noulQuestion).catch((e: unknown) => e)) as JevClientError;

      expect(error.category).toBe("JEV_INVALID_RESPONSE");
         });

   it("fails fast without an API key", async () => {
      const recorder = recordingFetch(async () => jsonResponse(successfulBody));
      const client = buildClient(recorder.impl, { getApiKey: () => undefined });

      const error = (await client.decide("state", noulQuestion).catch((e: unknown) => e)) as JevClientError;

      expect(error.category).toBe("JEV_AUTH_FAILURE");
      expect(recorder.calls).toHaveLength(0);
         });

   it("redacts raw keys that leak into upstream error bodies", async () => {
      const recorder = recordingFetch(async () =>
            new Response("failed with key dk-secretvalue1234567890", { status: 500 }),
               );
      const client = buildClient(recorder.impl, { retries: 0 });

      const error = (await client.decide("state", noulQuestion).catch((e: unknown) => e)) as JevClientError;

      expect(error.message).not.toContain("dk-secretvalue1234567890");
      expect(error.message).toContain("dk-");
         });

   it("exercises score and noul answer schemas through score() and evaluate()", async () => {
      const body = {
            model: "jev-1.13.0",
            answers: {
                  rating: { type: "score", score: 2.5, confidence: 0.8, probabilities: { "2": 0.5, "3": 0.5 } },
                  statement: { type: "noul", noul: 0.91 },
                        },
            usage: { input_tokens: 50 },
               };
      const recorder = recordingFetch(async () => jsonResponse(body));
      const client = buildClient(recorder.impl);

      const scored = await client.score("state", ["low", "medium", "high"], "How severe?");
      expect(scoreAnswerSchema.safeParse(scored.response.answers.rating).success).toBe(true);

      const evaluated = await client.evaluate("state", "Is this urgent?");
      expect(noulAnswerSchema.safeParse(evaluated.response.answers.statement).success).toBe(true);
         });
});

describe("JevClient convenience methods", () => {
   it("route uses a choice question named task_type", async () => {
      const recorder = recordingFetch(async () =>
            jsonResponse({
                  model: "jev-1.13.0",
                  answers: { task_type: { type: "choice", choice: "bug", confidence: 0.9 } },
                        }),
               );
      const client = buildClient(recorder.impl);

      await client.route("null pointer in checkout");
      expect(recorder.body().questions.task_type?.type).toBe("choice");
         });

   it("assessComplexity uses five ordered levels", async () => {
      const recorder = recordingFetch(async () =>
            jsonResponse({ model: "jev-1.13.0", answers: { complexity: { type: "score", score: 1 } } }),
               );
      const client = buildClient(recorder.impl);

      await client.assessComplexity("rename a variable");
      expect(recorder.body().questions.complexity?.criteria).toHaveLength(5);
         });

   it("shouldEscalate uses a noul question", async () => {
      const recorder = recordingFetch(async () =>
            jsonResponse({ model: "jev-1.13.0", answers: { escalate: { type: "noul", noul: 0.3 } } }),
               );
      const client = buildClient(recorder.impl);

      await client.shouldEscalate("edit a typo");
      expect(recorder.body().questions.escalate?.type).toBe("noul");
         });

   it("chooseStrategy uses a choice question with caller criteria", async () => {
      const recorder = recordingFetch(async () =>
            jsonResponse({ model: "jev-1.13.0", answers: { strategy: { type: "choice", choice: "logs" } } }),
               );
      const client = buildClient(recorder.impl);

      await client.chooseStrategy("502s", { logs: "read logs", diff: "read git diff" });
      expect(Object.keys(recorder.body().questions.strategy?.criteria as object)).toEqual([
            "logs",
            "diff",
               ]);
         });

   it("testConnection returns ok with the resolved model", async () => {
      const recorder = recordingFetch(async () =>
            jsonResponse({
                  model: "jev-1.13.0",
                  answers: { subsystem: { type: "choice", choice: "ingress", confidence: 0.8 } },
                        }),
               );
      const client = buildClient(recorder.impl);

      const result = await client.testConnection();
      expect(result.ok).toBe(true);
      expect(result.model).toBe("jev-1.13.0");
         });
});

describe("retry helpers", () => {
   it("classifies retryable statuses", () => {
      for (const status of [408, 429, 500, 502, 503, 504, 529]) {
            expect(isRetryableStatus(status)).toBe(true);
               }
      for (const status of [400, 401, 403, 404, 422]) {
            expect(isRetryableStatus(status)).toBe(false);
               }
         });

   it("grows exponentially and caps the delay", () => {
      const policy = { retries: 8, baseDelayMs: 100, maxDelayMs: 1_000 };
      expect(backoffDelayMs(0, policy, null, false, () => 1)).toBe(100);
      expect(backoffDelayMs(1, policy, null, false, () => 1)).toBe(200);
      expect(backoffDelayMs(10, policy, null, false, () => 1)).toBe(1_000);
         });

   it("honors Retry-After in seconds and clamps to the max delay", () => {
      const policy = { retries: 3, baseDelayMs: 10, maxDelayMs: 1_000 };
      expect(backoffDelayMs(0, policy, "2", true)).toBe(1_000);
      expect(backoffDelayMs(0, policy, "0.1", true)).toBe(100);
      expect(retryAfterMs(null, 1_000)).toBeUndefined();
         });
});
