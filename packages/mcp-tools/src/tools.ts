import { toJSONSchema, type ZodType } from "zod";
import {
   COMPLEXITY_LEVELS,
   ESCALATION_CONSIDERATIONS,
   TASK_TYPE_CRITERIA,
   callerMetaSchema,
   guidanceLevel,
   normalizeCaller,
   noulVerdict,
   type ConfidenceThresholds,
   type ErrorCategory,
   type JevAnswer,
   type JevQuestion,
   type JevState,
   type RequestStorageMode,
} from "@jevai/shared";
import { JevClient, JevClientError, type DecideResult } from "@jevai/jev-client";
import {
   JEV_ASSESS_COMPLEXITY_DESCRIPTION,
   JEV_CHOOSE_STRATEGY_DESCRIPTION,
   JEV_DECIDE_DESCRIPTION,
   JEV_ROUTE_TASK_DESCRIPTION,
   JEV_SHOULD_ESCALATE_DESCRIPTION,
   jevAssessComplexityInputSchema,
   jevChooseStrategyInputSchema,
   jevDecideInputSchema,
   jevRouteTaskInputSchema,
   jevShouldEscalateInputSchema,
} from "./schemas.ts";

export interface ToolCallRecord {
   requestId: string;
   timestamp: string;
   caller: string;
   tool: string;
   model: string | null;
   durationMs: number;
   inputTokens: number | null;
   outputTokens: number | null;
   status: "success" | "error";
   errorCategory: ErrorCategory | null;
   errorMessage: string | null;
   clientVersion: string | null;
   project: string | null;
   repository: string | null;
   sessionId: string | null;
   questionCount: number | null;
   stateSizeChars: number | null;
   stateJson: string | null;
   responseJson: string | null;
}

export interface ToolRecorder {
   record(request: ToolCallRecord): void;
}

export interface ToolPrivacy {
   requestState: RequestStorageMode;
   storeResponses: boolean;
}

export type JevDecider = Pick<JevClient, "decide">;

export interface ToolDeps {
   client: JevDecider;
   recorder: ToolRecorder;
   privacy: () => ToolPrivacy;
   thresholds?: () => ConfidenceThresholds;
}

export interface ToolErrorPayload {
   type: ErrorCategory;
   message: string;
   retryable: boolean;
   status_code?: number;
}

export interface ToolResultPayload {
   success: boolean;
   request_id: string;
   tool: string;
   duration_ms?: number;
   model?: string;
   answers?: Record<string, JevAnswer & { guidance?: string; verdict?: string }>;
   usage?: { input_tokens?: number; output_tokens?: number };
   error?: ToolErrorPayload;
}

export interface ToolResult {
   payload: ToolResultPayload;
   isError: boolean;
   record: ToolCallRecord;
}

export type ToolName =
    "jev_decide"
    | "jev_route_task"
    | "jev_assess_complexity"
    | "jev_should_escalate"
    | "jev_choose_strategy";

type QuestionsResult =
    | { ok: true; questions: Record<string, JevQuestion> }
    | { ok: false; error: string };

const questionsOk = (questions: Record<string, JevQuestion>): QuestionsResult => ({
    ok: true,
    questions,
   });

const questionsFail = (error: string): QuestionsResult => ({ ok: false, error });

type QuestionsFromArgs = (args: Record<string, unknown>) => QuestionsResult;

export interface ToolDefinition {
   name: ToolName;
   description: string;
   inputSchema: ZodType;
   questions: QuestionsFromArgs;
}

const FAIL_OPEN =
   "Continue using your normal reasoning process. Jev is an optimization, not a dependency.";

function failOpenMessage(category: ErrorCategory, detail: string): string {
   switch (category) {
      case "JEV_UNAVAILABLE":
         return `Jev API is temporarily unavailable. ${FAIL_OPEN}`;
      case "JEV_TIMEOUT":
         return `Jev API timed out while answering. ${FAIL_OPEN}`;
      case "JEV_RATE_LIMITED":
         return `Jev API rate limit reached, retry in a moment. ${FAIL_OPEN}`;
      case "JEV_AUTH_FAILURE":
         return `Jev API rejected the configured API key. Ask an administrator to fix the key in Settings. ${FAIL_OPEN}`;
      case "JEV_BAD_REQUEST":
      case "JEV_INVALID_RESPONSE":
         return `Jev could not answer this request: ${detail}`.slice(0, 400);
      default:
         return `Jev request failed. ${FAIL_OPEN}`;
   }
}

function stateSize(state: unknown): number {
   if (typeof state === "string") return state.length;
   try {
      return JSON.stringify(state ?? "").length;
   } catch {
      return 0;
   }
}

function answerWithGuidance(
   answer: JevAnswer,
   thresholds: ConfidenceThresholds,
): JevAnswer & { guidance?: string; verdict?: string } {
   if (answer.type === "noul") {
      return { ...answer, verdict: noulVerdict(answer.noul, thresholds) };
   }
   if (answer.confidence !== undefined) {
      return { ...answer, guidance: guidanceLevel(answer.confidence, thresholds) };
   }
   return answer;
}

export const toolDefinitions: ToolDefinition[] = [
   {
      name: "jev_decide",
      description: JEV_DECIDE_DESCRIPTION,
      inputSchema: jevDecideInputSchema,
      questions: (args) => questionsOk((args.questions ?? {}) as Record<string, JevQuestion>),
   },
   {
      name: "jev_route_task",
      description: JEV_ROUTE_TASK_DESCRIPTION,
      inputSchema: jevRouteTaskInputSchema,
      questions: (args) => {
         const custom = args.choices as Record<string, string | null> | undefined;
         const criteria =
            custom && Object.keys(custom).length > 0 ? custom : TASK_TYPE_CRITERIA;
         return questionsOk({
            task_type: {
               type: "choice",
               instructions: "What type of software engineering task is being performed?",
               criteria,
                 },
                 });
              },
    },
    {
      name: "jev_assess_complexity",
      description: JEV_ASSESS_COMPLEXITY_DESCRIPTION,
      inputSchema: jevAssessComplexityInputSchema,
      questions: () =>
         questionsOk({
            complexity: {
               type: "score",
               instructions:
                      "How complex and risky is completing this task? Levels are ordered from trivial to high-risk.",
               criteria: [...COMPLEXITY_LEVELS],
                  },
               }),
    },
    {
      name: "jev_should_escalate",
      description: JEV_SHOULD_ESCALATE_DESCRIPTION,
      inputSchema: jevShouldEscalateInputSchema,
      questions: () =>
         questionsOk({
            escalate: {
               type: "noul",
               instructions: `Should the primary AI agent escalate to deeper or more expensive reasoning? ${ESCALATION_CONSIDERATIONS}`,
                  },
               }),
    },
    {
      name: "jev_choose_strategy",
      description: JEV_CHOOSE_STRATEGY_DESCRIPTION,
      inputSchema: jevChooseStrategyInputSchema,
      questions: (args): QuestionsResult => {
         const strategies = args.strategies as Record<string, string | null> | undefined;
         if (!strategies || Object.keys(strategies).length < 2) {
            return questionsFail(
                   "strategies is required and must contain at least two options shaped as { name: description }."
                   );
                  }
         return questionsOk({
            strategy: {
               type: "choice",
               instructions:
                      "Which investigation strategy or tool should be used first for this situation?",
               criteria: strategies,
                  },
               });
              },
    },
];

export const toolByName = new Map<string, ToolDefinition>(toolDefinitions.map((d) => [d.name, d]));

export function listToolDefinitions(): Array<{
   name: string;
   description: string;
   inputSchema: unknown;
}> {
   return toolDefinitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: toJSONSchema(definition.inputSchema, { target: "draft-2020-12" }),
      }));
}

const noopRecorder: ToolRecorder = { record: () => undefined };

export async function handleToolCall(
   name: string,
   args: unknown,
   deps: ToolDeps,
): Promise<ToolResult> {
   const requestId = crypto.randomUUID();
   const startedAt = performance.now();
   const rawArgs = args && typeof args === "object" ? (args as Record<string, unknown>) : {};

   const metaParse = callerMetaSchema.safeParse(rawArgs.caller ?? {});
   const meta = metaParse.success ? metaParse.data : {};

   const baseRecord = (overrides: Partial<ToolCallRecord>): ToolCallRecord => ({
      requestId,
      timestamp: new Date().toISOString(),
      caller: normalizeCaller(meta.caller),
      tool: name,
      model: null,
      durationMs: Math.round(performance.now() - startedAt),
      inputTokens: null,
      outputTokens: null,
      status: "success",
      errorCategory: null,
      errorMessage: null,
      clientVersion: meta.client_version ?? null,
      project: meta.project ?? null,
      repository: meta.repository ?? null,
      sessionId: meta.session_id ?? null,
      questionCount: null,
      stateSizeChars: null,
      stateJson: null,
      responseJson: null,
      ...overrides,
      });

   const finalize = (payload: ToolResultPayload, record: ToolCallRecord): ToolResult => {
      deps.recorder.record(record);
      return { payload, isError: payload.success === false, record };
      };

   const definition = toolByName.get(name);
   if (!definition) {
      const message = `Unknown tool: ${name}. Valid tools: ${toolDefinitions.map((d) => d.name).join(", ")}.`;
      const record = baseRecord({
         status: "error",
         errorCategory: "VALIDATION_ERROR",
         errorMessage: message,
         });
      return finalize(
         {
            success: false,
            request_id: requestId,
            tool: name,
            duration_ms: record.durationMs,
            error: { type: "VALIDATION_ERROR", message, retryable: false },
               },
         record,
         );
      }

   const parsedArgs = definition.inputSchema.safeParse(rawArgs);
   if (!parsedArgs.success) {
      const issueText = (parsedArgs.error?.issues ?? [])
         .slice(0, 5)
         .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
         .join("; ");
      const message = `Invalid arguments: ${issueText}`;
      const record = baseRecord({
         status: "error",
         errorCategory: "VALIDATION_ERROR",
         errorMessage: message,
         });
      return finalize(
         {
            success: false,
            request_id: requestId,
            tool: definition.name,
            duration_ms: record.durationMs,
            error: { type: "VALIDATION_ERROR", message, retryable: false },
               },
         record,
         );
      }

   const validatedArgs = (parsedArgs.data ?? {}) as Record<string, unknown>;
   const questionsResult = definition.questions(validatedArgs);
   const state = validatedArgs.state as JevState | undefined;

   if (!questionsResult.ok) {
      const message = questionsResult.error;
      const record = baseRecord({
         status: "error",
         errorCategory: "VALIDATION_ERROR",
         errorMessage: message,
         stateSizeChars: stateSize(state),
         questionCount: 0,
         });
      return finalize(
         {
            success: false,
            request_id: requestId,
            tool: definition.name,
            duration_ms: record.durationMs,
            error: { type: "VALIDATION_ERROR", message, retryable: false },
               },
         record,
         );
      }

   if (state === undefined || state === null) {
      const message = "state is required and must be a non-empty string, object, or array.";
      const record = baseRecord({
         status: "error",
         errorCategory: "VALIDATION_ERROR",
         errorMessage: message,
         });
      return finalize(
         {
            success: false,
            request_id: requestId,
            tool: definition.name,
            duration_ms: record.durationMs,
            error: { type: "VALIDATION_ERROR", message, retryable: false },
               },
         record,
         );
      }

   const questions = questionsResult.questions;
   const privacy = deps.privacy ?? (() => ({ requestState: "metadata_only", storeResponses: true }));
   const storage = privacy();

   try {
      const decided: DecideResult = await deps.client.decide(state, questions, {
         requestId,
         caller: normalizeCaller(meta.caller),
         });
      const thresholds = deps.thresholds?.() ?? {};
      const answers: Record<string, JevAnswer & { guidance?: string; verdict?: string }> = {};
      for (const [questionName, answer] of Object.entries(decided.response.answers)) {
         answers[questionName] = answerWithGuidance(answer, thresholds);
         }
      const record = baseRecord({
         status: "success",
         model: decided.model,
         durationMs: decided.durationMs,
         inputTokens: decided.usage?.input_tokens ?? null,
         outputTokens: decided.usage?.output_tokens ?? null,
         questionCount: Object.keys(questions).length,
         stateSizeChars: stateSize(state),
         stateJson:
               storage.requestState === "full" ? JSON.stringify(state).slice(0, 20_000) : null,
         responseJson: storage.storeResponses
               ? JSON.stringify(answers).slice(0, 20_000)
                : null,
         });
      return finalize(
         {
            success: true,
            request_id: requestId,
            tool: definition.name,
            duration_ms: decided.durationMs,
            model: decided.model,
            answers,
            usage: decided.usage
                  ? {
                        input_tokens: decided.usage.input_tokens,
                        output_tokens: decided.usage.output_tokens,
                        }
                  : undefined,
               },
         record,
         );
      } catch (error) {
      const category: ErrorCategory =
         error instanceof JevClientError ? error.category : "INTERNAL_ERROR";
      const detail = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof JevClientError ? error.retryable : false;
      const statusCode = error instanceof JevClientError ? error.statusCode : undefined;
      const record = baseRecord({
         status: "error",
         errorCategory: category,
         errorMessage: detail,
         questionCount: Object.keys(questions).length,
         stateSizeChars: stateSize(state),
         stateJson:
               storage.requestState === "full" && state !== undefined
                  ? JSON.stringify(state).slice(0, 20_000)
                  : null,
         });
      return finalize(
         {
            success: false,
            request_id: requestId,
            tool: definition.name,
            duration_ms: record.durationMs,
            error: {
                  type: category,
                  message: failOpenMessage(category, detail),
                  retryable,
                  ...(statusCode !== undefined ? { status_code: statusCode } : {}),
                  },
               },
         record,
         );
      }
}

export function collectingRecorder(): ToolRecorder & { entries: ToolCallRecord[] } {
   const entries: ToolCallRecord[] = [];
   return {
      entries,
      record(request: ToolCallRecord) {
         entries.push(request);
         },
      };
}

export { noopRecorder };
