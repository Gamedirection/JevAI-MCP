export interface RetryPolicy {
   retries: number;
   baseDelayMs: number;
   maxDelayMs: number;
}

export const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

export function isRetryableStatus(status: number): boolean {
   return RETRYABLE_STATUS_CODES.has(status);
}

export function backoffDelayMs(
   attempt: number,
   policy: RetryPolicy,
   retryAfterHeader?: string | null,
   honorRetryAfter = true,
   random: () => number = Math.random,
): number {
   if (honorRetryAfter) {
      const fromHeader = retryAfterMs(retryAfterHeader ?? null, policy.maxDelayMs);
      if (fromHeader !== undefined) return fromHeader;
      }
   const exponential = policy.baseDelayMs * 2 ** attempt;
   const capped = Math.min(exponential, policy.maxDelayMs);
   const jittered = capped * (0.5 + random() / 2);
   return Math.max(1, Math.round(jittered));
}

export function retryAfterMs(
   headerValue: string | null,
   maxDelayMs: number,
): number | undefined {
   if (!headerValue) return undefined;
   const seconds = Number.parseFloat(headerValue);
   if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.round(seconds * 1000), maxDelayMs);
      }
   const date = Date.parse(headerValue);
   if (!Number.isNaN(date)) {
      const delta = date - Date.now();
      if (delta > 0) return Math.min(delta, maxDelayMs);
       }
   return undefined;
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
   new Promise((resolve, reject) => {
      if (signal?.aborted) {
         reject(new Error("aborted"));
         return;
        }
      const onAbort = () => {
         clearTimeout(timer);
         reject(new Error("aborted"));
        };
      const timer = setTimeout(() => {
         signal?.removeEventListener("abort", onAbort);
         resolve();
        }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
     });
