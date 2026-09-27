import { z } from "zod";

export const logComponentSchema = z.enum([
   "mcp",
   "jev",
   "api",
   "database",
    "system",
    "frontend",
]);
export type LogComponent = z.infer<typeof logComponentSchema>;

export interface LogRecord {
   id: number;
   timestamp: string;
   level: "debug" | "info" | "warn" | "error";
   component: LogComponent;
   message: string;
   context: Record<string, unknown> | null;
}

export type RequestStatus = "success" | "error";

export type ErrorCategory =
    | "none"
    | "JEV_UNAVAILABLE"
    | "JEV_AUTH_FAILURE"
    | "JEV_RATE_LIMITED"
    | "JEV_TIMEOUT"
    | "JEV_INVALID_RESPONSE"
    | "JEV_BAD_REQUEST"
    | "VALIDATION_ERROR"
    | "INTERNAL_ERROR";

export interface RequestRecord {
   id: number;
   requestId: string;
   timestamp: string;
   caller: string;
   tool: string;
   model: string | null;
   durationMs: number;
   inputTokens: number | null;
   outputTokens: number | null;
   status: RequestStatus;
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

export type ConnectionState =
    | "connected"
    | "disconnected"
    | "timeout"
    | "auth_failure"
    | "rate_limited"
    | "recovered"
    | "unknown";

export interface ConnectionEvent {
   id: number;
   timestamp: string;
   state: ConnectionState;
   reason: string | null;
   statusCode: number | null;
}

export interface CallerMeta {
   caller?: string;
   client_version?: string;
   project?: string;
   repository?: string;
   session_id?: string;
}

export const callerMetaSchema = z.object({
   caller: z.string().min(1).max(64).optional(),
   client_version: z.string().min(1).max(64).optional(),
   project: z.string().min(1).max(200).optional(),
   repository: z.string().min(1).max(300).optional(),
   session_id: z.string().min(1).max(200).optional(),
});

export function normalizeCaller(value: string | undefined): string {
   if (!value) return "unknown";
   return value.trim().toLowerCase().slice(0, 64) || "unknown";
}
