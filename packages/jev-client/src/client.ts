import {
   COMPLEXITY_LEVELS,
   DEFAULT_EXAMPLE_OPTIONS,
   DEFAULT_EXAMPLE_QUESTION,
   DEFAULT_EXAMPLE_STATE,
   ESCALATION_CONSIDERATIONS,
   TASK_TYPE_CRITERIA,
   type ConnectionState,
   type ErrorCategory,
   type JevDecisionRequest,
   type JevDecisionResponse,
   type JevQuestion,
   type JevState,
   type JevUsage,
   jevDecisionResponseSchema,
   normalizeCaller,
} from "@jevai/shared";
import { JevClientError, jevErrorPayload, type JevErrorDetail } from "./errors.ts";
import {
   backoffDelayMs,
   retryAfterMs,
   sleep,
   type RetryPolicy,
} from "./retry.ts";

export interface JevClientLogger {
   debug(message: string, context?: Record<string, unknown>): void;
   info(message: string, context?: Record<string, unknown>): void;
   warn(message: string, context?: Record<string, unknown>): void;
   error(message: string, context?: Record<string, unknown>): void;
}

export interface JevClientOptions {
   endpoint: string;
   model: string;
   getApiKey: () => string | undefined;
   /**
    * Additional provider credentials to try in order. A key is only valid at
    * the endpoint that issued it, so each entry carries its own endpoint and
    * model. The client moves to the next entry on an auth failure or a rate
    * limit and stops on any other error, because a second key cannot fix a
    * bad request or a wrong endpoint.
    */
   backupCredentials?: BackupCredential[];
   timeoutMs: number;
   retries: number;
   retryBaseDelayMs?: number;
   retryMaxDelayMs?: number;
   logger?: JevClientLogger;
   fetchImpl?: typeof fetch;
}

export interface DecideOptions {
   requestId?: string;
   caller?: string;
   signal?: AbortSignal;
}

export interface BackupCredential {
   /** Shown in logs. Never the key itself. */
   label: string;
   endpoint: string;
   model: string;
   getApiKey: () => string | undefined;
}

export interface DecideResult {
   response: JevDecisionResponse;
   durationMs: number;
   model: string;
   /** Label of the credential that answered. Useful when a backup was used. */
   credentialLabel?: string;
   /** True when the answer came from a backup rather than the primary credential. */
   usedBackup?: boolean;
   usage?: JevUsage;
   requestId: string;
   attempts: number;
}

export interface JevConnectionStatus {
   state: ConnectionState;
   lastSuccessAt: string | null;
   lastFailureAt: string | null;
   lastFailureReason: string | null;
   lastFailureStatus: number | null;
}

export type ConnectionChangeListener = (
   previous: JevConnectionStatus,
   current: JevConnectionStatus,
) => void;

const DEFAULT_LOGGER: JevClientLogger = {
   debug: () => undefined,
   info: () => undefined,
   warn: () => undefined,
   error: () => undefined,
};

/** A credential with its endpoint already normalised. */
interface ResolvedCredential {
   label: string;
   endpoint: string;
   model: string;
   getApiKey: () => string | undefined;
}

export class JevClient {
   private endpoint: string;
   private model: string;
   private timeoutMs: number;
   private retries: number;
   private retryBaseDelayMs: number;
   private retryMaxDelayMs: number;
   private readonly getApiKey: () => string | undefined;
   private readonly backupCredentials: BackupCredential[];
   private readonly logger: JevClientLogger;
   private readonly fetchImpl: typeof fetch;

   private status: JevConnectionStatus = {
      state: "unknown",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      lastFailureStatus: null,
   };
   private readonly listeners = new Set<ConnectionChangeListener>();

   constructor(options: JevClientOptions) {
      this.endpoint = normalizeEndpoint(options.endpoint);
      this.model = options.model;
      this.getApiKey = options.getApiKey;
      this.backupCredentials = options.backupCredentials ?? [];
      this.timeoutMs = options.timeoutMs;
      this.retries = options.retries;
      this.retryBaseDelayMs = options.retryBaseDelayMs ?? 300;
      this.retryMaxDelayMs = options.retryMaxDelayMs ?? 5_000;
      this.logger = options.logger ?? DEFAULT_LOGGER;
      const fetchImpl = options.fetchImpl ?? fetch;
      if (!fetchImpl) throw new Error("No fetch implementation available.");
      this.fetchImpl = fetchImpl;
   }

   updateOptions(
      options: Partial<
         Pick<
            JevClientOptions,
               | "endpoint"
               | "model"
               | "timeoutMs"
               | "retries"
               | "retryBaseDelayMs"
               | "retryMaxDelayMs"
          >
         >,
   ): void {
      if (options.endpoint !== undefined) this.endpoint = normalizeEndpoint(options.endpoint);
      if (options.model !== undefined) this.model = options.model;
      if (options.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
      if (options.retries !== undefined) this.retries = options.retries;
      if (options.retryBaseDelayMs !== undefined) {
         this.retryBaseDelayMs = options.retryBaseDelayMs;
         }
      if (options.retryMaxDelayMs !== undefined) {
         this.retryMaxDelayMs = options.retryMaxDelayMs;
         }
     }

   onConnectionChange(listener: ConnectionChangeListener): () => void {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
   }

   getConnectionStatus(): JevConnectionStatus {
      return { ...this.status };
   }

   getModel(): string {
      return this.model;
   }

   getEndpoint(): string {
      return this.endpoint;
   }

   async decide(
      state: JevState,
      questions: Record<string, JevQuestion>,
      options: DecideOptions = {},
   ): Promise<DecideResult> {
      const requestId = options.requestId ?? crypto.randomUUID();
      const caller = normalizeCaller(options.caller);
      const body: JevDecisionRequest = { state, questions };
      const policy: RetryPolicy = {
         retries: this.retries,
         baseDelayMs: this.retryBaseDelayMs,
         maxDelayMs: this.retryMaxDelayMs,
         };
      const totalAttempts = policy.retries + 1;
      const startedAt = performance.now();
      let lastError: JevClientError | undefined;

      for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
         if (options.signal?.aborted) {
            throw new JevClientError(
                "Jev request was cancelled.",
               { category: "JEV_TIMEOUT", retryable: true, attempts: attempt },
               requestId,
               );
            }
         try {
            const result = await this.attemptWithChain(requestId, caller, body);
            const durationMs = Math.round(performance.now() - startedAt);
            this.recordSuccess();
            return {
               response: result.response,
               durationMs,
               model: result.response.model,
               usage: result.response.usage,
               requestId,
               attempts: attempt,
               credentialLabel: result.credential.label,
               usedBackup: result.usedBackup,
               };
            } catch (error) {
            const jevError = withAttempt(error, attempt, requestId);
            lastError = jevError;
            const failureDurationMs = Math.round(performance.now() - startedAt);
            this.recordFailure(
               connectionStateFor(jevError),
               jevError.message,
               jevError.statusCode ?? null,
               );
            this.logger.warn("jev request attempt failed", {
               component: "jev",
               requestId,
               caller,
               attempt,
               maxAttempts: totalAttempts,
               category: jevError.category,
               statusCode: jevError.statusCode ?? null,
               durationMs: failureDurationMs,
               retryable: jevError.retryable,
               });
            const canRetry =
                  jevError.retryable &&
                  attempt < totalAttempts &&
                  !options.signal?.aborted &&
                  !isAuthFailureLoop(jevError, attempt);
            if (!canRetry) throw jevError;
            const waitMs = backoffDelayMs(
               attempt - 1,
               policy,
               jevError.retryAfterHeader,
               jevError.statusCode === 429,
               );
            await sleep(waitMs, options.signal);
            }
         }
      throw lastError ?? new JevClientError(
         "Jev request failed.",
          { category: "INTERNAL_ERROR", retryable: false, attempts: totalAttempts },
         requestId,
         );
   }

   route(
      state: JevState,
      criteria: Record<string, string | null> = TASK_TYPE_CRITERIA,
      options: DecideOptions = {},
   ): Promise<DecideResult> {
      return this.decide(
         state,
          {
            task_type: {
               type: "choice",
               instructions: "What type of software engineering task is being performed?",
               criteria,
               },
             },
         options,
         );
   }

   score(
      state: JevState,
      criteria: readonly string[],
      instructions: string,
      options: DecideOptions = {},
   ): Promise<DecideResult> {
      return this.decide(
         state,
          { rating: { type: "score", instructions, criteria: [...criteria] } },
         options,
         );
   }

   evaluate(state: JevState, statement: string, options: DecideOptions = {}): Promise<DecideResult> {
      return this.decide(
         state,
          { statement: { type: "noul", instructions: statement } },
         options,
         );
   }

   assessComplexity(state: JevState, options: DecideOptions = {}): Promise<DecideResult> {
      return this.decide(
         state,
          {
            complexity: {
               type: "score",
               instructions:
                     "How complex and risky is completing this task? Levels are ordered from trivial to high-risk.",
               criteria: [...COMPLEXITY_LEVELS],
               },
             },
         options,
         );
   }

   shouldEscalate(state: JevState, options: DecideOptions = {}): Promise<DecideResult> {
      return this.decide(
         state,
          {
            escalate: {
               type: "noul",
               instructions:
                     `Should the primary AI agent escalate to deeper or more expensive reasoning? ${ESCALATION_CONSIDERATIONS}`,
               },
             },
         options,
         );
   }

   chooseStrategy(
      state: JevState,
      criteria: Record<string, string | null>,
      options: DecideOptions = {},
   ): Promise<DecideResult> {
      return this.decide(
         state,
          {
            strategy: {
               type: "choice",
               instructions:
                     "Which investigation strategy or tool should be used first for this situation?",
               criteria,
               },
             },
         options,
         );
   }

   async testConnection(): Promise<{
      ok: boolean;
      durationMs: number;
      model?: string;
      error?: JevErrorDetail;
      }> {
      const startedAt = performance.now();
      try {
         const result = await this.decide(
            DEFAULT_EXAMPLE_STATE,
             {
               subsystem: {
                  type: "choice",
                  instructions: DEFAULT_EXAMPLE_QUESTION,
                  criteria: Object.fromEntries(DEFAULT_EXAMPLE_OPTIONS.map((option) => [option, null])),
                  },
                },
             { caller: "dashboard" },
            );
         return {
            ok: true,
            durationMs: Math.round(performance.now() - startedAt),
            model: result.model,
               };
         } catch (error) {
         return {
            ok: false,
            durationMs: Math.round(performance.now() - startedAt),
            error: jevErrorPayload(error, "connection-test").error,
                 };
            }
   }

   /**
    * Tries the primary credential, then each backup in order. A backup is
    * only reached when the failure is credential specific, meaning an auth
    * failure or a rate limit. Every other error is thrown immediately.
    */
   private async attemptWithChain(
      requestId: string,
      caller: string,
      body: JevDecisionRequest,
   ): Promise<{ response: JevDecisionResponse; credential: ResolvedCredential; usedBackup: boolean }> {
      const chain: ResolvedCredential[] = [
         {
            label: "primary",
            endpoint: this.endpoint,
            model: this.model,
            getApiKey: this.getApiKey,
            },
         ...this.backupCredentials.map((credential) => ({
            label: credential.label,
            endpoint: normalizeEndpoint(credential.endpoint),
            model: credential.model,
            getApiKey: credential.getApiKey,
            })),
      ];

      for (let position = 0; position < chain.length; position += 1) {
         const credential = chain[position] as ResolvedCredential;
         const isLast = position === chain.length - 1;

         if (!credential.getApiKey()) {
            if (isLast) {
               throw new JevClientError(
                  "No Jev API key configured. Set DEFAPI_API_KEY or save a key in Settings.",
                  { category: "JEV_AUTH_FAILURE", retryable: false, attempts: 1 },
                  requestId,
                  );
               }
            this.logger.warn("jev credential has no key, skipping", {
               component: "jev",
               requestId,
               credential: credential.label,
            });
            continue;
         }

         try {
            const response = await this.attempt(requestId, caller, body, credential);
            if (position > 0) {
               this.logger.info("jev answered from a backup credential", {
                  component: "jev",
                  requestId,
                  caller,
                  credential: credential.label,
                  model: credential.model,
               });
            }
            return { response, credential, usedBackup: position > 0 };
         } catch (error) {
            if (isLast || !isCredentialFailure(error)) throw error;
            this.logger.warn("jev credential failed, trying the next one", {
               component: "jev",
               requestId,
               caller,
               credential: credential.label,
               category: (error as JevClientError).category,
               statusCode: (error as JevClientError).statusCode ?? null,
            });
         }
      }

      throw new JevClientError(
         "No Jev API key configured. Set DEFAPI_API_KEY or save a key in Settings.",
         { category: "JEV_AUTH_FAILURE", retryable: false, attempts: 1 },
         requestId,
         );
   }

   private async attempt(
      requestId: string,
      caller: string,
      body: JevDecisionRequest,
      credential: ResolvedCredential,
   ): Promise<JevDecisionResponse> {
      const apiKey = credential.getApiKey();
      if (!apiKey) {
         throw new JevClientError(
             "No Jev API key configured. Set DEFAPI_API_KEY or save a key in Settings.",
             { category: "JEV_AUTH_FAILURE", retryable: false, attempts: 1 },
            requestId,
            );
         }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = performance.now();
      try {
         const response = await this.fetchImpl(`${credential.endpoint}/systemone`, {
            method: "POST",
            signal: controller.signal,
            headers: {
               "Content-Type": "application/json",
               Accept: "application/json",
               Authorization: `Bearer ${apiKey}`,
               "X-Request-Id": requestId,
               "User-Agent": "jevai-mcp/1.0.0",
               },
            body: JSON.stringify({ model: credential.model, state: body.state, questions: body.questions }),
               });
         if (!response.ok) {
               const text = await safeReadText(response);
               const category = statusCategory(response.status, text);
               const retryAfter = response.headers.get("retry-after");
               throw withRetryAfter(
                  new JevClientError(
                     friendlyMessage(category, httpStatusText(response.status, text)),
                     {
                        category,
                        retryable:
                              category === "JEV_RATE_LIMITED" ||
                              (category === "JEV_UNAVAILABLE" && isRetryableHttpStatus(response.status)),
                        statusCode: response.status,
                        attempts: 1,
                        },
                     requestId,
                     ),
                  retryAfter,
                  );
               }
         let json: unknown;
         try {
               json = await response.json();
               } catch {
            throw new JevClientError(
                  "Jev API returned a success status with a body that is not valid JSON.",
                  { category: "JEV_INVALID_RESPONSE", retryable: true, attempts: 1 },
                  requestId,
                  );
               }
         const parsed = jevDecisionResponseSchema.safeParse(json);
         if (!parsed.success) {
               this.logger.debug("jev response failed schema validation", {
                  component: "jev",
                  requestId,
                  issues: parsed.error.issues.slice(0, 5).map((issue) => ({
                     path: issue.path.join("."),
                     message: issue.message,
                     })),
                     });
            throw new JevClientError(
                  "Jev API returned a response that does not match the expected schema.",
                  { category: "JEV_INVALID_RESPONSE", retryable: true, attempts: 1 },
                  requestId,
                  );
               }
         this.logger.info("jev request completed", {
            component: "jev",
            requestId,
            caller,
            durationMs: Math.round(performance.now() - startedAt),
            model: parsed.data.model,
            inputTokens: parsed.data.usage?.input_tokens ?? null,
            questionCount: Object.keys(body.questions).length,
            serverRequestId:
                  response.headers.get("x-request-id") ??
                  response.headers.get("x-correlation-id") ??
                  undefined,
               });
         return parsed.data;
         } catch (error) {
         if (error instanceof JevClientError) throw error;
         if (isAbortError(error)) {
               throw new JevClientError(
                  `Jev API request timed out after ${this.timeoutMs} ms.`,
                  { category: "JEV_TIMEOUT", retryable: true, attempts: 1 },
                  requestId,
                  );
               }
         const message = error instanceof Error ? error.message : String(error);
         throw new JevClientError(
               friendlyMessage("JEV_UNAVAILABLE", message),
               { category: "JEV_UNAVAILABLE", retryable: true, attempts: 1 },
               requestId,
               );
         } finally {
         clearTimeout(timer);
         }
   }

   private recordSuccess(): void {
      const previous = this.status;
      const now = new Date().toISOString();
      this.status = {
         ...previous,
         state: "connected",
         lastSuccessAt: now,
         };
      this.notify(previous, this.status);
   }

   private recordFailure(
      state: ConnectionState,
      reason: string,
      statusCode: number | null,
   ): void {
      const previous = this.status;
      this.status = {
         state,
         lastSuccessAt: previous.lastSuccessAt,
         lastFailureAt: new Date().toISOString(),
         lastFailureReason: reason,
         lastFailureStatus: statusCode,
         };
      this.notify(previous, this.status);
   }

   private notify(previous: JevConnectionStatus, current: JevConnectionStatus): void {
      if (previous.state === current.state) return;
      for (const listener of this.listeners) {
         try {
            listener(previous, current);
               } catch {
            // Listener failures must not break the client.
               }
            }
   }
}

function withRetryAfter(error: JevClientError, retryAfterHeader: string | null): JevClientError {
   if (retryAfterHeader !== null) error.retryAfterHeader = retryAfterHeader;
   return error;
}

function isRetryableHttpStatus(status: number): boolean {
   return status === 408 || status === 425 || (status >= 500 && status <= 599);
}

function isAuthFailureLoop(error: JevClientError, attempt: number): boolean {
   return error.category === "JEV_AUTH_FAILURE" && attempt > 1;
}

/**
 * True when a different credential could plausibly succeed. An expired or
 * revoked key and an exhausted quota are both credential problems. A 404 or a
 * malformed request is not, so those never rotate.
 */
function isCredentialFailure(error: unknown): boolean {
   if (!(error instanceof JevClientError)) return false;
   return error.category === "JEV_AUTH_FAILURE" || error.category === "JEV_RATE_LIMITED";
}

function normalizeEndpoint(endpoint: string): string {
   const trimmed = endpoint.trim().replace(/\/+$/, "");
   if (!/^https?:\/\/.+/i.test(trimmed)) {
      throw new Error(`Jev endpoint must be an http(s) URL. Received: ${endpoint}`);
      }
   return trimmed;
}

function statusCategory(status: number, bodyText: string): ErrorCategory {
   if (status === 401 || status === 403) return "JEV_AUTH_FAILURE";
   if (status === 429) return "JEV_RATE_LIMITED";
   if (status === 400 || status === 404 || status === 422) return "JEV_BAD_REQUEST";
   if (status >= 500) return status === 529 ? "JEV_UNAVAILABLE" : "JEV_UNAVAILABLE";
   if (/rate.?limit/i.test(bodyText)) return "JEV_RATE_LIMITED";
   return "JEV_INVALID_RESPONSE";
}

function httpStatusText(status: number, text: string): string {
   const snippet = text.trim().replace(/\s+/g, " ").slice(0, 300);
   return `HTTP ${status}${snippet ? `: ${snippet}` : ""}`;
}

async function safeReadText(response: Response): Promise<string> {
   try {
      return await response.text();
      } catch {
      return "";
      }
}

function isAbortError(error: unknown): boolean {
   if (error instanceof Error && error.name === "AbortError") return true;
   const message = error instanceof Error ? error.message : String(error);
   return /abort/i.test(message);
}

function friendlyMessage(category: ErrorCategory, detail: string): string {
   const base = (() => {
      switch (category) {
         case "JEV_UNAVAILABLE":
               return "Jev API is temporarily unavailable.";
         case "JEV_TIMEOUT":
               return "Jev API timed out while answering.";
         case "JEV_RATE_LIMITED":
               return "Jev API rate limit reached.";
         case "JEV_AUTH_FAILURE":
               return "Jev API rejected the configured API key.";
         case "JEV_BAD_REQUEST":
               return "Jev API rejected the request as invalid.";
         case "JEV_INVALID_RESPONSE":
               return "Jev API returned an unexpected response.";
         default:
               return "Jev request failed.";
            }
         })();
   return `${base} (${truncateDetail(detail)})`;
}

function truncateDetail(detail: string): string {
   const cleaned = detail.replace(/\s+/g, " ").trim();
   return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
}

function withAttempt(error: unknown, attempt: number, requestId: string): JevClientError {
   if (error instanceof JevClientError) {
      if (error.attempts === attempt) return error;
      const clone = new JevClientError(
         error.message,
         {
            category: error.category,
            retryable: error.retryable,
            statusCode: error.statusCode,
            attempts: attempt,
             },
         requestId,
         );
      if (error.retryAfterHeader !== undefined) clone.retryAfterHeader = error.retryAfterHeader;
      return clone;
      }
   const rawMessage = error instanceof Error ? error.message : String(error);
   const category: ErrorCategory = isAbortError(error)
      ? "JEV_TIMEOUT"
       : "JEV_UNAVAILABLE";
   return new JevClientError(
      friendlyMessage(category, rawMessage),
      {
         category,
         retryable: true,
         attempts: attempt,
            },
      requestId,
      );
}

function connectionStateFor(error: JevClientError): ConnectionState {
   switch (error.category) {
      case "JEV_TIMEOUT":
         return "timeout";
      case "JEV_AUTH_FAILURE":
         return "auth_failure";
      case "JEV_RATE_LIMITED":
         return "rate_limited";
      default:
         return "disconnected";
   }
}

export { retryAfterMs };
