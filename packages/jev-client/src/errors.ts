import { redactText, type ErrorCategory } from "@jevai/shared";

export interface JevFailure {
   category: ErrorCategory;
   retryable: boolean;
   statusCode?: number;
   attempts: number;
}

export interface JevErrorDetail {
   type: ErrorCategory;
   message: string;
   retryable: boolean;
   status_code?: number;
   request_id: string;
   attempts: number;
       }

export interface JevErrorEnvelope {
   success: false;
   error: JevErrorDetail;
       }

export class JevClientError extends Error {
   readonly category: ErrorCategory;
   readonly retryable: boolean;
   readonly statusCode?: number;
   readonly attempts: number;
   readonly requestId: string;
   retryAfterHeader?: string;

   constructor(message: string, failure: JevFailure, requestId: string) {
      super(redactText(message));
      this.name = "JevClientError";
      this.category = failure.category;
      this.retryable = failure.retryable;
      this.statusCode = failure.statusCode;
      this.attempts = failure.attempts;
      this.requestId = requestId;
    }

   toJSON(): JevErrorEnvelope {
      const detail: JevErrorDetail = {
              	type: this.category,
              	message: this.message,
              	retryable: this.retryable,
              	request_id: this.requestId,
              	attempts: this.attempts,
                     	};
      if (this.statusCode !== undefined) detail.status_code = this.statusCode;
      return { success: false, error: detail };
          	}
       	}

export function jevErrorPayload(error: unknown, requestId: string): JevErrorEnvelope {
   if (error instanceof JevClientError) return error.toJSON();
   const raw = error instanceof Error ? error.message : String(error);
   return {
      success: false,
      error: {
              	type: "INTERNAL_ERROR" satisfies ErrorCategory,
              	message: redactText(raw),
              	retryable: false,
              	request_id: requestId,
              	attempts: 1,
                     	},
          	};
       	}
