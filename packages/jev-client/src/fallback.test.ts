import { describe, expect, it, vi } from "vitest";
import type { JevQuestion, JevState } from "@jevai/shared";
import {
   FallbackError,
   LlmFallbackProvider,
   buildFallbackPrompt,
   buildFallbackProviders,
   coerceFallbackAnswers,
   runFallbackChain,
} from "./fallback.ts";

const QUESTIONS: Record<string, JevQuestion> = {
   task_type: {
      type: "choice",
      instructions: "What type of task?",
      criteria: { bug: "defect", infrastructure: "platform" },
   },
};

const jsonResponse = (body: unknown, status = 200): Response =>
   new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
   });

const completion = (content: string) =>
   jsonResponse({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe("buildFallbackPrompt", () => {
   it("lists the exact option keys so the model cannot invent one", () => {
      const prompt = buildFallbackPrompt("a crashlooping pod", QUESTIONS);
      expect(prompt).toContain("a crashlooping pod");
      expect(prompt).toContain("bug");
      expect(prompt).toContain("infrastructure");
      expect(prompt).toContain("JSON");
   });

   it("serialises object state rather than dropping it", () => {
      const prompt = buildFallbackPrompt({ error: "CrashLoopBackOff" }, QUESTIONS);
      expect(prompt).toContain("CrashLoopBackOff");
   });

   it("describes score and noul questions", () => {
      const prompt = buildFallbackPrompt("x", {
         sev: { type: "score", instructions: "How bad?", criteria: ["fine", "bad"] },
         esc: { type: "noul", instructions: "Escalate?" },
      });
      expect(prompt).toContain("0: fine");
      expect(prompt).toContain("between 0 and 1");
   });
});

describe("coerceFallbackAnswers", () => {
   it("returns a choice without any confidence value", () => {
      const answers = coerceFallbackAnswers(QUESTIONS, { answers: { task_type: "bug" } });
      expect(answers.task_type).toEqual({ type: "choice", choice: "bug" });
      expect(answers.task_type).not.toHaveProperty("confidence");
   });

   it("rejects a choice key that is not in the criteria", () => {
      expect(() => coerceFallbackAnswers(QUESTIONS, { answers: { task_type: "made_up" } })).toThrow(
         /not one of/,
      );
   });

   it("rejects a missing question instead of guessing it", () => {
      expect(() => coerceFallbackAnswers(QUESTIONS, { answers: {} })).toThrow(/missing question/);
   });

   it("bounds a score index to the rubric length", () => {
      const q: Record<string, JevQuestion> = {
         sev: { type: "score", instructions: "How bad?", criteria: ["fine", "bad"] },
      };
      expect(coerceFallbackAnswers(q, { answers: { sev: 1 } }).sev).toEqual({ type: "score", score: 1 });
      expect(() => coerceFallbackAnswers(q, { answers: { sev: 7 } })).toThrow(/0-1/);
   });

   it("clamps a noul to the 0-1 range", () => {
      const q: Record<string, JevQuestion> = { esc: { type: "noul", instructions: "Escalate?" } };
      expect(coerceFallbackAnswers(q, { answers: { esc: 0.8 } }).esc).toEqual({ type: "noul", noul: 0.8 });
      expect(() => coerceFallbackAnswers(q, { answers: { esc: 4 } })).toThrow(/between 0 and 1/);
   });
});

describe("LlmFallbackProvider", () => {
   it("omits confidence from the answer it builds", async () => {
      const fetchImpl = vi.fn(async () => completion('{"answers":{"task_type":"infrastructure"}}'));
      const provider = new LlmFallbackProvider({
         name: "local_llm",
         baseUrl: "http://mac:11434/v1",
         model: "qwen3.5:122b",
         timeoutMs: 5_000,
         fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await provider.decide("pod down", QUESTIONS);
      expect(result.response.answers.task_type).toEqual({ type: "choice", choice: "infrastructure" });
      expect(result.response.answers.task_type).not.toHaveProperty("confidence");
   });

   it("strips code fences around the JSON", async () => {
      const fetchImpl = vi.fn(async () =>
         completion('```json\n{"answers":{"task_type":"bug"}}\n```'),
      );
      const provider = new LlmFallbackProvider({
         name: "cloud_llm",
         baseUrl: "https://api.example/v1/",
         model: "some-model",
         timeoutMs: 5_000,
         fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const result = await provider.decide("x", QUESTIONS);
      expect(result.response.answers.task_type).toEqual({ type: "choice", choice: "bug" });
   });

   it("sends the bearer token only when one is configured", async () => {
      const withKey = vi.fn(async () => completion('{"answers":{"task_type":"bug"}}'));
      await new LlmFallbackProvider({
         name: "cloud_llm",
         baseUrl: "https://api.example/v1",
         model: "m",
         apiKey: "secret-token",
         timeoutMs: 5_000,
         fetchImpl: withKey as unknown as typeof fetch,
      }).decide("x", QUESTIONS);
      const headers = (withKey.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer secret-token");

      const withoutKey = vi.fn(async () => completion('{"answers":{"task_type":"bug"}}'));
      await new LlmFallbackProvider({
         name: "local_llm",
         baseUrl: "http://mac:11434/v1",
         model: "m",
         timeoutMs: 5_000,
         fetchImpl: withoutKey as unknown as typeof fetch,
      }).decide("x", QUESTIONS);
      const noAuth = (withoutKey.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
      expect(noAuth.Authorization).toBeUndefined();
   });

   it("raises FallbackError on an HTTP failure", async () => {
      const provider = new LlmFallbackProvider({
         name: "cloud_llm",
         baseUrl: "https://api.example/v1",
         model: "m",
         timeoutMs: 5_000,
         fetchImpl: (async () => jsonResponse({ error: "boom" }, 500)) as unknown as typeof fetch,
      });
      await expect(provider.decide("x", QUESTIONS)).rejects.toBeInstanceOf(FallbackError);
   });
});

describe("runFallbackChain", () => {
   const local = (fetchImpl: typeof fetch) =>
      new LlmFallbackProvider({
         name: "local_llm",
         baseUrl: "http://mac:11434/v1",
         model: "local-model",
         timeoutMs: 5_000,
         fetchImpl,
      });
   const cloud = (fetchImpl: typeof fetch) =>
      new LlmFallbackProvider({
         name: "cloud_llm",
         baseUrl: "https://api.example/v1",
         model: "cloud-model",
         timeoutMs: 5_000,
         fetchImpl,
      });

   it("stops at the first provider that answers", async () => {
      const cloudFetch = vi.fn(async () => completion('{"answers":{"task_type":"bug"}}'));
      const result = await runFallbackChain("x", QUESTIONS, {
         providers: [
            local((async () => completion('{"answers":{"task_type":"infrastructure"}}')) as unknown as typeof fetch),
            cloud(cloudFetch as unknown as typeof fetch),
         ],
      });
      expect(result.decision.source).toBe("local_llm");
      expect(cloudFetch).not.toHaveBeenCalled();
   });

   it("falls through to the cloud provider when the local one fails", async () => {
      const result = await runFallbackChain("x", QUESTIONS, {
         providers: [
            local((async () => {
               throw new Error("connection refused");
            }) as unknown as typeof fetch),
            cloud((async () => completion('{"answers":{"task_type":"bug"}}')) as unknown as typeof fetch),
         ],
      });
      expect(result.decision.source).toBe("cloud_llm");
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0]?.provider).toBe("local_llm");
   });

   it("records every failure when nothing answers", async () => {
      await expect(
         runFallbackChain("x", QUESTIONS, {
            providers: [
               local((async () => {
                  throw new Error("down");
               }) as unknown as typeof fetch),
               cloud((async () => {
                  throw new Error("also down");
               }) as unknown as typeof fetch),
            ],
         }),
      ).rejects.toThrow(/all fallback providers failed/);
   });
});

describe("buildFallbackProviders", () => {
   const base = { enabled: true, localTimeoutMs: 1, cloudTimeoutMs: 1 };

   it("returns nothing when disabled", () => {
      expect(
         buildFallbackProviders({ ...base, enabled: false, localBaseUrl: "http://x", localModel: "m" }),
      ).toHaveLength(0);
   });

   it("keeps local ahead of cloud", () => {
      const providers = buildFallbackProviders({
         ...base,
         localBaseUrl: "http://mac:11434/v1",
         localModel: "local-model",
         cloudBaseUrl: "https://api.example/v1",
         cloudModel: "cloud-model",
      });
      expect(providers.map((p) => p.name)).toEqual(["local_llm", "cloud_llm"]);
   });

   it("skips a provider that is missing its url or model", () => {
      expect(buildFallbackProviders({ ...base, localBaseUrl: "http://mac:11434/v1" })).toHaveLength(0);
      expect(buildFallbackProviders({ ...base, cloudModel: "m" })).toHaveLength(0);
   });
});

describe("fallback answers stay uncalibrated", () => {
   it("never produces a confidence field even when the model volunteers one", async () => {
      const state: JevState = "a failing test";
      const questions: Record<string, JevQuestion> = {
         escalate: { type: "noul", instructions: "Escalate?" },
      };
      const fetchImpl = vi.fn(async () =>
         completion('{"answers":{"escalate":0.95}}'),
      );
      const provider = new LlmFallbackProvider({
         name: "local_llm",
         baseUrl: "http://mac:11434/v1",
         model: "m",
         timeoutMs: 5_000,
         fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const { decision } = await runFallbackChain(state, questions, { providers: [provider] });
      const answer = decision.response.answers.escalate as Record<string, unknown>;
      expect(answer.noul).toBe(0.95);
      expect(answer).not.toHaveProperty("confidence");
   });
});
