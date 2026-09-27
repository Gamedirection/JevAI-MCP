import type {
   AgentStat,
   Bootstrap,
   ConnectionEventData,
   DashboardData,
   Envelope,
   IntegrationsData,
   LogRow,
   RedactedSettings,
   RequestDetail,
   RequestFacets,
   RequestRow,
   SystemStatus,
   TestDecisionResult,
   VersionInfo,
} from "./types.ts";

export class ApiError extends Error {
   readonly status: number;
   readonly details: unknown;
   constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.details = details;
         }
}

const BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
   const response = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
      ...init,
          });
   const contentType = response.headers.get("content-type") ?? "";
   if (!contentType.includes("application/json")) {
      if (!response.ok) throw new ApiError(response.status, `${response.status} ${response.statusText}`);
      return (await response.text()) as unknown as T;
          }
   const envelope = (await response.json()) as Envelope<T>;
   if (envelope.success === true) return envelope.data as T;
   if (envelope.data !== undefined) return envelope.data as T;
   throw new ApiError(
      response.status,
      envelope.error?.message ?? `${response.status} ${response.statusText}`,
      envelope.error?.details,
   );
}

function query(params: ListParams): string {
   const search = new URLSearchParams();
   for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      search.set(key, String(value));
   }
   const serialized = search.toString();
   return serialized ? `?${serialized}` : "";
}

export interface ListParams {
   range?: string;
   from?: string;
   to?: string;
   caller?: string;
   tool?: string;
   status?: string;
   model?: string;
   search?: string;
   limit?: number;
   offset?: number;
   level?: string;
   component?: string;
   after?: number;
   format?: string;
}

export const api = {
   bootstrap: () => request<Bootstrap>("/api/bootstrap"),

   dashboard: (params: ListParams) => request<DashboardData>(`/api/dashboard${query(params)}`),

   requests: (params: ListParams) =>
      request<{ records: RequestRow[]; total: number }>(`/api/requests${query(params)}`),

   requestFacets: () => request<RequestFacets>("/api/requests/facets"),

   requestDetail: (id: number) => request<RequestDetail>(`/api/requests/${id}`),

   agents: (params: ListParams) => request<AgentStat[]>(`/api/agents${query(params)}`),

   logs: (params: ListParams) =>
      request<{ records: LogRow[]; total: number; maxId: number; live?: LogRow[] }>(`/api/logs${query(params)}`),

   settings: () => request<RedactedSettings>("/api/settings"),

   saveSettings: (settings: unknown) =>
      request<RedactedSettings>("/api/settings", {
         method: "PUT",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ settings }),
              }),

   saveApiKey: (apiKey: string) =>
      request<RedactedSettings>("/api/settings/api-key", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ apiKey }),
              }),

   deleteApiKey: () => request<RedactedSettings>("/api/settings/api-key", { method: "DELETE" }),

   resetSettings: () => request<RedactedSettings>("/api/settings/reset", { method: "POST" }),

   integrations: () => request<IntegrationsData>("/api/integrations"),

   testDecision: (body: { state?: string; question?: string; options?: string[] }) =>
      request<TestDecisionResult>("/api/integrations/test-decision", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(body),
              }),

   systemStatus: () => request<SystemStatus>("/api/system/status"),

   connectionEvents: (limit = 100) =>
      request<ConnectionEventData>(`/api/system/connection-events${query({ limit })}`),

   testJevConnection: () => request<TestDecisionResult>("/api/system/test-jev-connection", { method: "POST" }),

   runRetention: () =>
      request<{ requestsDeleted: number; logsDeleted: number; connectionEventsDeleted: number }>(
         "/api/system/run-retention",
         { method: "POST" },
      ),

   version: () => request<VersionInfo>("/api/version"),
};

export function downloadUrl(path: string): string {
   return `${BASE}${path}`;
}
