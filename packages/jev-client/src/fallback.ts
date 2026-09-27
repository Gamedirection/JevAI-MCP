import type {
   JevAnswer,
   JevDecisionResponse,
   JevQuestion,
   JevState,
} from "@jevai/shared";

/**
 * Where a decision came from. "jev" is the calibrated System One model.
 * The LLM sources are uncalibrated guesses and never carry a confidence.
 */
export type DecisionSource = "jev" | "local_llm" | "cloud_llm";

export interface FallbackLogger {
   debug(message: string, context?: Record<string, unknown>): void;
   info(message: string, context?: Record<string, unknown>): void;
   warn(message: string, context?: Record<string, unknown>): void;
   error(message: string, context?: Record<string, unknown>): void;
}

export interface LlmProviderOptions {
   name: Exclude<DecisionSource, "jev">;
   baseUrl: string;
   model: string;
   apiKey?: string;
   timeoutMs: number;
   logger?: FallbackLogger;
   fetchImpl?: typeof fetch;
   maxTokens?: number;
}

export interface LlmDecision {
   response: JevDecisionResponse;
   durationMs: number;
   usage?: { input_tokens?: number; output_tokens?: number };
}

export interface FallbackDecision extends LlmDecision {
   source: Exclude<DecisionSource, "jev">;
}

export class FallbackError extends Error {
   readonly provider: string;
   readonly statusCode?: number;

   constructor(provider: string, message: string, statusCode?: number) {
      super(message);
      this.name = "FallbackError";
      this.provider = provider;
      this.statusCode = statusCode;
   }
}

const stateToText = (state: JevState): string =>
   typeof state === "string" ? state : JSON.stringify(state);

function describeQuestion(name: string, question: JevQuestion): string {
   if (question.type === "choice") {
      const options = Object.entries(question.criteria)
         .map(([key, description]) => `- ${key}: ${description ?? "no description"}`)
         .join("\n");
      return [
         `"${name}" (choice) ${question.instructions}`,
         options,
         `Reply with one of these exact keys: ${Object.keys(question.criteria).join(", ")}`,
      ].join("\n");
   }
   if (question.type === "score") {
      return [
         `"${name}" (score) ${question.instructions}`,
         `Levels: ${question.criteria.map((level, index) => `${index}: ${level}`).join("; ")}`,
         `Reply with an integer index from 0 to ${question.criteria.length - 1}.`,
      ].join("\n");
   }
   return [
      `"${name}" (noul) ${question.instructions}`,
      "Reply with a single number between 0 and 1 (probability of yes).",
   ].join("\n");
}

export function buildFallbackPrompt(
   state: JevState,
   questions: Record<string, JevQuestion>,
): string {
   const blocks = Object.entries(questions).map(([name, question]) =>
      describeQuestion(name, question),
   );
   return [
      "You are answering structured decision questions about a piece of software work.",
      "Answer every question. Reply with JSON only, no prose and no code fences.",
      "",
      "STATE:",
      stateToText(state),
      "",
      "QUESTIONS:",
      ...blocks,
      "",
      'Reply in exactly this shape: {"answers": {"<question name>": <value>}}',
      "For a choice the value is the option key as a string.",
      "For a score the value is the integer level index.",
      "For a noul the value is a number between 0 and 1.",
   ].join("\n");
}

function extractJson(text: string): unknown {
   const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
   const candidate = (fenced?.[1] ?? text).trim();
   const start = candidate.indexOf("{");
   const end = candidate.lastIndexOf("}");
   if (start === -1 || end === -1 || end <= start) {
      throw new Error("fallback response contained no JSON object");
   }
   return JSON.parse(candidate.slice(start, end + 1));
}

function coerceAnswer(
   question: JevQuestion,
   raw: unknown,
): JevAnswer {
   if (question.type === "choice") {
      const keys = Object.keys(question.criteria);
      if (typeof raw !== "string" || !keys.includes(raw)) {
         throw new Error(`choice answer ${JSON.stringify(raw)} is not one of: ${keys.join(", ")}`);
      }
      return { type: "choice", choice: raw };
   }
   if (question.type === "score") {
      const max = question.criteria.length - 1;
      const index = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(index) || index < 0 || index > max) {
         throw new Error(`score answer ${JSON.stringify(raw)} is not an integer 0-${max}`);
      }
      return { type: "score", score: index };
   }
   const value = typeof raw === "number" ? raw : Number(raw);
   if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`noul answer ${JSON.stringify(raw)} is not between 0 and 1`);
   }
   return { type: "noul", noul: value };
}

export function coerceFallbackAnswers(
   questions: Record<string, JevQuestion>,
   parsed: unknown,
): Record<string, JevAnswer> {
   const rawAnswers = (parsed as { answers?: Record<string, unknown> } | null)?.answers;
   if (!rawAnswers || typeof rawAnswers !== "object") {
      throw new Error("fallback response had no answers object");
   }
   const answers: Record<string, JevAnswer> = {};
   for (const [name, question] of Object.entries(questions)) {
      if (!(name in rawAnswers)) {
         throw new Error(`fallback response is missing question ${name}`);
      }
      answers[name] = coerceAnswer(question, rawAnswers[name]);
   }
   return answers;
}

export class LlmFallbackProvider {
   readonly name: Exclude<DecisionSource, "jev">;
   private readonly options: LlmProviderOptions;

   constructor(options: LlmProviderOptions) {
      this.name = options.name;
      this.options = options;
   }

   async decide(
      state: JevState,
      questions: Record<string, JevQuestion>,
      signal?: AbortSignal,
   ): Promise<LlmDecision> {
      const doFetch = this.options.fetchImpl ?? fetch;
      const startedAt = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      const onAbort = (): void => controller.abort();
      signal?.addEventListener("abort", onAbort);

      try {
         const response = await doFetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
               "Content-Type": "application/json",
               ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
            },
            body: JSON.stringify({
               model: this.options.model,
               messages: [
                  {
                     role: "system",
                     content:
                        "You are a precise decision engine. You reply with JSON only and never explain.",
                  },
                  { role: "user", content: buildFallbackPrompt(state, questions) },
               ],
               temperature: 0,
               max_tokens: this.options.maxTokens ?? 800,
               response_format: { type: "json_object" },
            }),
            signal: controller.signal,
            });

         if (!response.ok) {
            const body = (await response.text().catch(() => "")).slice(0, 300);
            throw new FallbackError(
               this.name,
               `${this.options.model} returned HTTP ${response.status}: ${body}`,
               response.status,
            );
         }

         const payload = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
         };
         const text = payload.choices?.[0]?.message?.content ?? "";
         const answers = coerceFallbackAnswers(questions, extractJson(text));

         return {
            response: { model: this.options.model, answers },
            durationMs: Math.round(performance.now() - startedAt),
            usage: {
               input_tokens: payload.usage?.prompt_tokens,
               output_tokens: payload.usage?.completion_tokens,
            },
            };
      } catch (error) {
         if (error instanceof FallbackError) throw error;
         const detail = error instanceof Error ? error.message : String(error);
         throw new FallbackError(this.name, `${this.options.model} failed: ${detail}`);
      } finally {
         clearTimeout(timer);
         signal?.removeEventListener("abort", onAbort);
      }
   }
}

export interface FallbackChainOptions {
   providers: LlmFallbackProvider[];
   logger?: FallbackLogger;
}

export interface FallbackChainResult {
   decision: FallbackDecision;
   /** Every provider that was tried, with the reason it did not answer. */
   attempts: { provider: string; error: string }[];
}

/**
 * Tries each provider in order and returns the first usable answer.
 * Throws only when every provider has failed.
 */
export async function runFallbackChain(
   state: JevState,
   questions: Record<string, JevQuestion>,
   options: FallbackChainOptions,
   signal?: AbortSignal,
): Promise<FallbackChainResult> {
   const attempts: { provider: string; error: string }[] = [];

   for (const provider of options.providers) {
      try {
         const decision = await provider.decide(state, questions, signal);
         options.logger?.warn("jev failed, fallback answered", {
            provider: provider.name,
            model: decision.response.model,
            durationMs: decision.durationMs,
            skipped: attempts,
         });
         return { decision: { ...decision, source: provider.name }, attempts };
      } catch (error) {
         const detail = error instanceof Error ? error.message : String(error);
         attempts.push({ provider: provider.name, error: detail });
         options.logger?.warn("fallback provider failed", {
            provider: provider.name,
            error: detail,
         });
      }
   }

   throw new FallbackError(
      "chain",
      `all fallback providers failed: ${attempts
         .map((attempt) => `${attempt.provider}: ${attempt.error}`)
         .join("; ")}`,
   );
}

export interface FallbackConfig {
   enabled: boolean;
   localBaseUrl?: string;
   localModel?: string;
   cloudBaseUrl?: string;
   cloudModel?: string;
   cloudApiKey?: string;
   localTimeoutMs: number;
   cloudTimeoutMs: number;
}

export const FALLBACK_DEFAULTS = {
   localTimeoutMs: 20_000,
   cloudTimeoutMs: 25_000,
} as const;

export function buildFallbackProviders(
   config: FallbackConfig,
   logger?: FallbackLogger,
   fetchImpl?: typeof fetch,
): LlmFallbackProvider[] {
   if (!config.enabled) return [];
   const providers: LlmFallbackProvider[] = [];
   if (config.localBaseUrl && config.localModel) {
      providers.push(
         new LlmFallbackProvider({
            name: "local_llm",
            baseUrl: config.localBaseUrl,
            model: config.localModel,
            timeoutMs: config.localTimeoutMs,
            logger,
            fetchImpl,
         }),
      );
   }
   if (config.cloudBaseUrl && config.cloudModel) {
      providers.push(
         new LlmFallbackProvider({
            name: "cloud_llm",
            baseUrl: config.cloudBaseUrl,
            model: config.cloudModel,
            ...(config.cloudApiKey ? { apiKey: config.cloudApiKey } : {}),
            timeoutMs: config.cloudTimeoutMs,
            logger,
            fetchImpl,
         }),
      );
   }
   return providers;
}
