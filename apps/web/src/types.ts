import type {
   ApiKeySource,
   AppSettings,
   ConnectionEvent,
   ConnectionState,
   ErrorCategory,
   LogComponent,
   LogLevel,
   RequestStatus,
   TimeRangePreset,
} from "@jevai/shared";

export type { ApiKeySource, AppSettings, ConnectionEvent, ConnectionState, TimeRangePreset };

export interface Envelope<T> {
   success: boolean;
   data?: T;
   error?: { message: string; details?: unknown };
}

export interface Bootstrap {
   version: { version: string; applicationName: string; commit: string | null; buildDate: string | null };
   defaultTimeRange: TimeRangePreset;
   refreshIntervalSeconds: number;
   mcpUrl: string;
   apiKeySource: ApiKeySource;
   thresholds: { use: number; guidance: number; noulYes: number; noulNo: number };
   tokenSavings: { enabled: boolean; estimatedAvoidedTokens: number };
   mcpEnabled: boolean;
}

export interface DashboardData {
   timeRange: { from: string; to: string; label: string; bucketSeconds: number };
   summary: {
      totalCalls: number;
      successfulCalls: number;
      failedCalls: number;
      successRate: number | null;
      avgDurationMs: number | null;
      inputTokens: number;
      estimatedTokensSaved: number | null;
      tokenSavingsEnabled: boolean;
      activeClients: number;
      lastRequestAt: string | null;
        };
   serviceStatus: {
      app: "healthy" | "degraded";
      jev: ConnectionState;
      database: "healthy" | "unhealthy";
      mcp: "running" | "disabled" | "stopped";
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastFailureReason: string | null;
      totalDisconnects: number;
        };
   timeline: Array<{
      bucket: string;
      success: number;
      failed: number;
      avgDurationMs: number | null;
      inputTokens: number;
          }>;
   byCaller: GroupRow[];
   byTool: GroupRow[];
}

export interface GroupRow {
   key: string;
   count: number;
   success: number;
   failed: number;
   avgDurationMs: number | null;
   inputTokens: number;
   lastSeenAt: string | null;
}

export interface RequestRow {
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
   questionCount: number | null;
   stateSizeChars: number | null;
   clientVersion: string | null;
   project: string | null;
}

export type RequestDetail = RequestRow & {
   repository: string | null;
   sessionId: string | null;
   state: unknown;
   stateNote?: string;
   response: unknown;
   responseNote?: string;
   errorMessage?: string | null;
   contentPolicy: { requestState: string; storeResponses: boolean };
};

export interface RequestFacets {
   callers: string[];
   tools: string[];
   models: string[];
}

export interface AgentStat {
   caller: string;
   known: boolean;
   requests: number;
   successRate: number | null;
   avgDurationMs: number | null;
   inputTokens: number;
   mostUsedTool: string | null;
   lastSeenAt: string | null;
   lastSeenSecondsAgo: number | null;
}

export interface LogRow {
   id: number;
   timestamp: string;
   level: LogLevel;
   component: LogComponent;
   message: string;
   context: Record<string, unknown> | null;
}

export interface RedactedSettings {
   settings: AppSettings;
   apiKeySource: ApiKeySource;
   apiKeyMasked: string | null;
   mcpUrl: string;
   defaults: AppSettings;
   envOverrideKeys: string[];
}

export interface GuideFile {
   path: string;
   size: number;
}

export interface Guide {
   id: string;
   displayName: string;
   summary: string;
   requirements: string[];
   steps: Array<{ title: string; detail?: string[]; command?: string }>;
   verify: string;
   testCommand?: string;
   troubleshooting: Array<{ problem: string; fix: string }>;
   files: GuideFile[];
   zipName: string;
   lastCallAt: string | null;
}

export interface IntegrationsData {
   mcpUrl: string;
   guides: Guide[];
}

export interface SystemStatus {
   application: {
      version: string;
      commit: string | null;
      buildDate: string | null;
      startedAt: string;
      uptimeSeconds: number;
      node: string;
      platform: string;
        };
   jev: {
      state: ConnectionState;
      endpoint: string;
      model: string;
      apiKeySource: ApiKeySource;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastFailureReason: string | null;
      lastFailureStatus: number | null;
      totalDisconnects: number;
        };
   mcp: { enabled: boolean; host: string; port: number; url: string };
   database: {
      path: string;
      healthy: boolean;
      sizeBytes: number | null;
      schemaVersion: number;
        };
   memory: { rssBytes: number; heapUsedBytes: number };
}

export interface ConnectionEventData {
   events: ConnectionEvent[];
   current: {
      state: ConnectionState;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastFailureReason: string | null;
      lastFailureStatus: number | null;
         };
   totalDisconnects: number;
}

export interface VersionInfo {
   version: string;
   applicationName?: string;
   commit: string | null;
   buildDate: string | null;
}

export interface TestDecisionResult {
   ok: boolean;
   durationMs: number;
   model?: string;
   usage?: { input_tokens?: number } | null;
   raw?: unknown;
   error?: {
      type: string;
      message: string;
      retryable: boolean;
      status_code?: number;
      request_id?: string;
      attempts?: number;
         };
}
