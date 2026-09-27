import {
   type ConnectionEvent,
   type ConnectionState,
   type ErrorCategory,
   type LogComponent,
   type LogLevel,
   type LogRecord,
   type RequestRecord,
   redactText,
   redactValue,
} from "@jevai/shared";
import type { SqliteDb } from "./db.ts";

export function isoTimestamp(value: string | Date = new Date()): string {
   const date = value instanceof Date ? value : new Date(value);
   const isValid = !Number.isNaN(date.getTime());
   return (isValid ? date : new Date()).toISOString();
}

export interface NewRequestRecord {
   requestId: string;
   timestamp: string;
   caller: string;
   tool: string;
   model: string | null;
   durationMs: number;
   inputTokens: number | null;
   outputTokens: number | null;
   status: "success" | "error";
   errorCategory: string | null;
   errorMessage: string | null;
   clientVersion?: string | null;
   project?: string | null;
   repository?: string | null;
   sessionId?: string | null;
   questionCount?: number | null;
   stateSizeChars?: number | null;
   stateJson?: string | null;
   responseJson?: string | null;
}

export interface RequestFilters {
   caller?: string;
   tool?: string;
   status?: "success" | "error";
   model?: string;
   from?: string;
   to?: string;
   search?: string;
   limit?: number;
   offset?: number;
}

export interface RequestSummary {
   total: number;
   success: number;
   failed: number;
   avgDurationMs: number | null;
   inputTokens: number;
   estimatedTokensSaved: number;
   lastRequestAt: string | null;
}

export interface TimelinePoint {
   bucket: string;
   success: number;
   failed: number;
   avgDurationMs: number | null;
   inputTokens: number;
}

export interface GroupCount {
   key: string;
   count: number;
   success: number;
   failed: number;
   avgDurationMs: number | null;
   inputTokens: number;
   lastSeenAt: string | null;
   mostUsedTool: string | null;
}

function buildWhere(filters: RequestFilters): { clause: string; params: unknown[] } {
   const conditions: string[] = [];
   const params: unknown[] = [];
   if (filters.caller) { conditions.push("caller = ?"); params.push(filters.caller); }
   if (filters.tool) { conditions.push("tool = ?"); params.push(filters.tool); }
   if (filters.status) { conditions.push("status = ?"); params.push(filters.status); }
   if (filters.model) { conditions.push("model = ?"); params.push(filters.model); }
   const from = isoTimestamp(filters.from ?? "0000-01-01T00:00:00.000Z");
   const to = isoTimestamp(filters.to ?? "9999-12-31T23:59:59.999Z");
   conditions.push("timestamp >= ?");
   params.push(from);
   conditions.push("timestamp <= ?");
   params.push(to);
   if (filters.search) {
      conditions.push("(request_id LIKE ? OR project LIKE ? OR repository LIKE ? OR session_id LIKE ?)");
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
       }
   return {
      clause: `WHERE ${conditions.join(" AND ")}`,
      params,
       };
}

export class RequestRepository {
   constructor(private readonly db: SqliteDb) {}

   insert(record: NewRequestRecord): number {
      const result = this.db
          .prepare(
               `INSERT INTO requests (
                   request_id, timestamp, caller, tool, model, duration_ms,
                   input_tokens, output_tokens, status, error_category, error_message,
                   client_version, project, repository, session_id,
                   question_count, state_size_chars, state_json, response_json
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
             )
          .run(
               record.requestId,
               record.timestamp,
               record.caller,
               record.tool,
               record.model,
               record.durationMs,
               record.inputTokens,
               record.outputTokens,
               record.status,
               record.errorCategory,
               record.errorMessage ? redactText(record.errorMessage).slice(0, 1000) : null,
               record.clientVersion ?? null,
               record.project ?? null,
               record.repository ?? null,
               record.sessionId ?? null,
               record.questionCount ?? null,
               record.stateSizeChars ?? null,
               record.stateJson ?? null,
               record.responseJson ?? null,
             );
      return Number(result.lastInsertRowid);
      }

   list(filters: RequestFilters): { records: RequestRecord[]; total: number } {
      const { clause, params } = buildWhere(filters);
      const countRow = this.db
          .prepare(`SELECT COUNT(*) AS total FROM requests ${clause}`)
          .get(...params) as { total: number };
      const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
      const offset = Math.max(filters.offset ?? 0, 0);
      const rows = this.db
          .prepare(
               `SELECT * FROM requests ${clause}
                  ORDER BY timestamp DESC, id DESC
                  LIMIT ? OFFSET ?`,
             )
          .all(...params, limit, offset) as Array<Record<string, unknown>>;
      return { records: rows.map(mapRequestRow), total: countRow.total };
      }

   byId(id: number): RequestRecord | null {
      const row = this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as
         | Record<string, unknown>
         | undefined;
      return row ? mapRequestRow(row) : null;
      }

   summary(from: string, to: string): RequestSummary {
      const row = this.db
          .prepare(
               `SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed,
                    AVG(CASE WHEN status = 'success' THEN duration_ms END) AS avg_duration_ms,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    MAX(timestamp) AS last_request_at
                  FROM requests
                  WHERE timestamp >= ? AND timestamp <= ?`,
             )
               .get(isoTimestamp(from), isoTimestamp(to)) as {
               total: number | null;
               success: number | null;
               failed: number | null;
               avg_duration_ms: number | null;
               input_tokens: number | null;
               last_request_at: string | null;
            };
      return {
          total: row.total ?? 0,
         success: row.success ?? 0,
         failed: row.failed ?? 0,
         avgDurationMs: row.avg_duration_ms === null ? null : Math.round(row.avg_duration_ms),
         inputTokens: row.input_tokens ?? 0,
         estimatedTokensSaved: 0,
         lastRequestAt: row.last_request_at ?? null,
          };
      }

   timeline(
      from: string,
      to: string,
      bucketSeconds: number,
    ): TimelinePoint[] {
      const rows = this.db
          .prepare(
               `SELECT
                    strftime('%Y-%m-%dT%H:%M:%SZ',
                       datetime(floor(strftime('%s', timestamp) / ?) * ?, 'unixepoch')) AS bucket,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed,
                    AVG(CASE WHEN status = 'success' THEN duration_ms END) AS avg_duration_ms,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens
                  FROM requests
                  WHERE timestamp >= ? AND timestamp <= ?
                  GROUP BY bucket
                  ORDER BY bucket ASC`,
             )
           .all(bucketSeconds, bucketSeconds, isoTimestamp(from), isoTimestamp(to)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
         bucket: row.bucket as string,
         success: (row.success as number) ?? 0,
         failed: (row.failed as number) ?? 0,
         avgDurationMs:
               row.avg_duration_ms === null ? null : Math.round(row.avg_duration_ms as number),
         inputTokens: (row.input_tokens as number) ?? 0,
          }));
      }

   groupByColumn(
      column: "caller" | "tool",
      from: string,
      to: string,
    ): GroupCount[] {
      const safeColumn = column === "caller" ? "caller" : "tool";
      const rows = this.db
          .prepare(
               `SELECT
                    ${safeColumn} AS key,
                    COUNT(*) AS count,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed,
                    AVG(CASE WHEN status = 'success' THEN duration_ms END) AS avg_duration_ms,
                    COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    MAX(timestamp) AS last_seen_at
                  FROM requests
                  WHERE timestamp >= ? AND timestamp <= ?
                  GROUP BY key
                  ORDER BY count DESC
                  LIMIT 100`,
             )
          .all(from, to) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
         key: row.key as string,
         count: (row.count as number) ?? 0,
         success: (row.success as number) ?? 0,
         failed: (row.failed as number) ?? 0,
         avgDurationMs:
               row.avg_duration_ms === null ? null : Math.round(row.avg_duration_ms as number),
         inputTokens: (row.input_tokens as number) ?? 0,
         lastSeenAt: (row.last_seen_at as string | null) ?? null,
         mostUsedTool: null,
          }));
      }

   mostUsedToolForCaller(caller: string, from: string, to: string): string | null {
      const row = this.db
          .prepare(
               `SELECT tool FROM requests
                  WHERE caller = ? AND timestamp >= ? AND timestamp <= ?
                  GROUP BY tool ORDER BY COUNT(*) DESC LIMIT 1`,
             )
          .get(caller, from, to) as { tool: string } | undefined;
      return row?.tool ?? null;
      }

   distinctValues(column: "caller" | "tool" | "model"): string[] {
      const safeColumn = column === "model" ? "model" : column;
      const rows = this.db
          .prepare(
               `SELECT DISTINCT ${safeColumn} AS value FROM requests
                  WHERE ${safeColumn} IS NOT NULL ORDER BY value LIMIT 200`,
             )
          .all() as Array<{ value: string }>;
      return rows.map((row) => row.value);
      }

   purgeOlderThan(isoTimestamp: string): number {
      const result = this.db
          .prepare("DELETE FROM requests WHERE timestamp < ?")
          .run(isoTimestamp);
      return result.changes;
      }

   latestCallForCaller(caller: string): string | null {
      const row = this.db
            .prepare(
                  "SELECT timestamp FROM requests WHERE caller = ? ORDER BY timestamp DESC, id DESC LIMIT 1")
            .get(caller) as { timestamp: string } | undefined;
      return row?.timestamp ?? null;
   }

   counts(): { total: number; byStatus: Array<{ status: string; count: number }> } {
      const total = (
         this.db.prepare("SELECT COUNT(*) AS total FROM requests").get() as { total: number }
         ).total;
      const byStatus = this.db
          .prepare("SELECT status, COUNT(*) AS count FROM requests GROUP BY status")
          .all() as Array<{ status: string; count: number }>;
      return { total, byStatus };
      }
}

function mapRequestRow(row: Record<string, unknown>): RequestRecord {
   return {
      id: row.id as number,
      requestId: row.request_id as string,
      timestamp: row.timestamp as string,
      caller: row.caller as string,
      tool: row.tool as string,
      model: (row.model as string | null) ?? null,
      durationMs: row.duration_ms as number,
      inputTokens: (row.input_tokens as number | null) ?? null,
      outputTokens: (row.output_tokens as number | null) ?? null,
      status: row.status as "success" | "error",
      errorCategory: (row.error_category as ErrorCategory | null) ?? null,
      errorMessage: (row.error_message as string | null) ?? null,
      clientVersion: (row.client_version as string | null) ?? null,
      project: (row.project as string | null) ?? null,
      repository: (row.repository as string | null) ?? null,
      sessionId: (row.session_id as string | null) ?? null,
      questionCount: (row.question_count as number | null) ?? null,
      stateSizeChars: (row.state_size_chars as number | null) ?? null,
      stateJson: (row.state_json as string | null) ?? null,
      responseJson: (row.response_json as string | null) ?? null,
      };
}

export interface NewLogRecord {
   timestamp: string;
   level: LogLevel;
   component: LogComponent;
   message: string;
   context?: Record<string, unknown> | null;
}

export interface LogFilters {
   level?: LogLevel;
   component?: LogComponent;
   search?: string;
   from?: string;
   to?: string;
   limit?: number;
   offset?: number;
}

export class LogRepository {
   constructor(private readonly db: SqliteDb) {}

   insert(record: NewLogRecord): number {
      const safeContext = record.context ? JSON.stringify(redactValue(record.context)) : null;
      const result = this.db
          .prepare(
               "INSERT INTO logs (timestamp, level, component, message, context) VALUES (?, ?, ?, ?, ?)",
             )
          .run(
               record.timestamp,
               record.level,
               record.component,
               redactText(record.message),
               safeContext,
             );
      return Number(result.lastInsertRowid);
      }

   insertMany(records: NewLogRecord[]): void {
      if (records.length === 0) return;
      const stmt = this.db.prepare(
         "INSERT INTO logs (timestamp, level, component, message, context) VALUES (?, ?, ?, ?, ?)",
         );
      const insertAll = this.db.transaction((rows: NewLogRecord[]) => {
         for (const record of rows) {
            stmt.run(
                  record.timestamp,
                  record.level,
                  record.component,
                  redactText(record.message),
                  record.context ? JSON.stringify(redactValue(record.context)) : null,
                  );
                 }
              });
      insertAll(records);
      }

   list(filters: LogFilters): { records: LogRecord[]; total: number } {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filters.level) { conditions.push("level = ?"); params.push(filters.level); }
      if (filters.component) { conditions.push("component = ?"); params.push(filters.component); }
      if (filters.search) { conditions.push("message LIKE ?"); params.push(`%${filters.search}%`); }
      if (filters.from) { conditions.push("timestamp >= ?"); params.push(filters.from); }
      if (filters.to) { conditions.push("timestamp <= ?"); params.push(filters.to); }
      const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const total = (
         this.db.prepare(`SELECT COUNT(*) AS total FROM logs ${clause}`).get(...params) as {
               total: number;
            }
         ).total;
      const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
      const offset = Math.max(filters.offset ?? 0, 0);
      const rows = this.db
          .prepare(`SELECT * FROM logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
          .all(...params, limit, offset) as Array<Record<string, unknown>>;
      return { records: rows.map(mapLogRow), total };
      }

   purgeOlderThan(isoTimestamp: string): number {
      return this.db.prepare("DELETE FROM logs WHERE timestamp < ?").run(isoTimestamp).changes;
      }

   purgeAboveId(maxId: number): number {
      return this.db.prepare("DELETE FROM logs WHERE id <= ?").run(maxId).changes;
      }

   counts(): { total: number; byLevel: Array<{ level: string; count: number }> } {
      const total = (this.db.prepare("SELECT COUNT(*) AS total FROM logs").get() as { total: number })
         .total;
      const byLevel = this.db
          .prepare("SELECT level, COUNT(*) AS count FROM logs GROUP BY level")
          .all() as Array<{ level: string; count: number }>;
      return { total, byLevel };
      }
}

function mapLogRow(row: Record<string, unknown>): LogRecord {
   let context: Record<string, unknown> | null = null;
   if (typeof row.context === "string" && row.context.length > 0) {
      try {
         const parsed = JSON.parse(row.context);
         if (parsed && typeof parsed === "object") context = redactValue(parsed as Record<string, unknown>);
            } catch {
         context = null;
            }
         }
   return {
      id: row.id as number,
      timestamp: row.timestamp as string,
      level: row.level as LogLevel,
      component: row.component as LogComponent,
      message: row.message as string,
      context,
      };
}

export class ConnectionEventRepository {
   constructor(private readonly db: SqliteDb) {}

   insert(
      state: ConnectionState,
      reason: string | null,
      statusCode: number | null,
      timestamp?: string,
   ): number {
      const result = this.db
           .prepare(
                 "INSERT INTO connection_events (timestamp, state, reason, status_code) VALUES (?, ?, ?, ?)",
               )
           .run(
                 isoTimestamp(timestamp ?? new Date()),
                 state,
                 reason ? redactText(reason).slice(0, 500) : null,
                 statusCode,
                 );
      return Number(result.lastInsertRowid);
        }

   latest(limit: number): ConnectionEvent[] {
      const rows = this.db
          .prepare("SELECT * FROM connection_events ORDER BY id DESC LIMIT ?")
          .all(limit) as Array<Record<string, unknown>>;
      return rows.map(mapConnectionRow);
      }

   totalDisconnects(): number {
      const row = this.db
          .prepare(
               "SELECT COUNT(*) AS count FROM connection_events WHERE state IN " +
                  "('disconnected', 'timeout', 'auth_failure', 'rate_limited')",
             )
          .get() as { count: number };
      return row.count;
      }

   lastSuccessAt(): string | null {
      const row = this.db
          .prepare(
               "SELECT timestamp FROM connection_events WHERE state IN ('connected', 'recovered') " +
                  "ORDER BY id DESC LIMIT 1",
             )
          .get() as { timestamp: string } | undefined;
      return row?.timestamp ?? null;
      }

   lastFailure(): ConnectionEvent | null {
      const row = this.db
          .prepare(
               "SELECT * FROM connection_events WHERE state IN " +
                  "('disconnected', 'timeout', 'auth_failure', 'rate_limited') " +
                  "ORDER BY id DESC LIMIT 1",
             )
          .get() as Record<string, unknown> | undefined;
      return row ? mapConnectionRow(row) : null;
      }

   purgeOlderThan(isoTimestamp: string): number {
      return this.db
          .prepare("DELETE FROM connection_events WHERE timestamp < ?")
          .run(isoTimestamp).changes;
      }
}

function mapConnectionRow(row: Record<string, unknown>): ConnectionEvent {
   return {
      id: row.id as number,
      timestamp: row.timestamp as string,
      state: row.state as ConnectionState,
      reason: (row.reason as string | null) ?? null,
      statusCode: (row.status_code as number | null) ?? null,
      };
}

export class SettingsRepository {
   constructor(private readonly db: SqliteDb) {}

   get<T>(key: string): T | undefined {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
         | { value: string }
         | undefined;
      if (!row) return undefined;
      try {
         return JSON.parse(row.value) as T;
            } catch {
      return undefined;
            }
      }

   set(key: string, value: unknown): void {
      this.db
          .prepare(
               `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
             )
          .run(key, JSON.stringify(value), new Date().toISOString());
      }

   delete(key: string): void {
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      }

   keys(): string[] {
      return (this.db.prepare("SELECT key FROM settings ORDER BY key").all() as Array<{ key: string }>).map(
         (row) => row.key,
         );
      }

   getApiKeyHash(): string | undefined {
      return this.get<string>("jev.api_key_hash");
      }
}
