import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_SETTINGS } from "@jevai/shared";
import { Database } from "./index.ts";
import { openDatabase, runMigrations, MIGRATIONS } from "./db.ts";
import { maskApiKey } from "./api-key-store.ts";

function newDb() {
   return new Database(":memory:");
}

beforeEach(() => {
        });

describe("migrations", () => {
   it("applies migrations once and is idempotent", () => {
      const db = openDatabase(":memory:");
      const again = runMigrations(db);
      expect(again).toEqual([]);
      const versions = db
           .prepare("SELECT version FROM schema_migrations ORDER BY version")
           .all() as Array<{ version: number }>;
      expect(versions.map((v) => v.version)).toEqual(MIGRATIONS.map((m) => m.version));
         });
});

describe("RequestRepository", () => {
   it("inserts, lists, filters and summarizes requests", () => {
      const db = newDb();
      const base = {
         requestId: "r1",
         timestamp: "2026-09-26T10:00:00.000Z",
         caller: "codex",
         tool: "jev_decide",
         model: "jev-1.13.0",
         durationMs: 120,
         status: "success",
         } as const;
      db.requests.insert({ ...base, inputTokens: 100, outputTokens: 0, errorCategory: null, errorMessage: null });
      db.requests.insert({
         ...base,
         requestId: "r2",
         timestamp: "2026-09-26T10:05:00.000Z",
         caller: "claude-code",
         tool: "jev_route_task",
         status: "error",
         inputTokens: null,
         outputTokens: null,
         errorCategory: "JEV_TIMEOUT",
         errorMessage: "timed out",
            });

      const all = db.requests.list({ from: "2026-09-26T00:00:00Z", to: "2026-09-27T00:00:00Z" });
      expect(all.total).toBe(2);
      expect(all.records[0]?.requestId).toBe("r2");

      const byCaller = db.requests.list({ caller: "codex" });
      expect(byCaller.total).toBe(1);

      const summary = db.requests.summary("2026-09-26T00:00:00Z", "2026-09-27T00:00:00Z");
      expect(summary.total).toBe(2);
      expect(summary.success).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.avgDurationMs).toBe(120);
      expect(summary.inputTokens).toBe(100);
      expect(summary.lastRequestAt).toBe("2026-09-26T10:05:00.000Z");
       });

   it("masks leaked keys stored in error messages", () => {
      const db = newDb();
      db.requests.insert({
         requestId: "r-secret",
         timestamp: new Date().toISOString(),
         caller: "codex",
         tool: "jev_decide",
         model: null,
         durationMs: 10,
         inputTokens: null,
         outputTokens: null,
         status: "error",
         errorCategory: "JEV_AUTH_FAILURE",
         errorMessage: "upstream leaked dk-abcdefghijklmnop1234 and key sk-againsecret1234",
            });
      const record = db.requests.list({ limit: 1 }).records[0];
      expect(record?.errorMessage).toBeDefined();
      expect(record?.errorMessage).not.toContain("abcdefghijklmnop1234");
      expect(record?.errorMessage).toContain("dk-");
       });

   it("buckets timeline points", () => {
      const db = newDb();
      for (let minute = 0; minute < 6; minute += 1) {
            db.requests.insert({
               requestId: `r${minute}`,
               timestamp: `2026-09-26T10:${String(minute).padStart(2, "0")}:00.000Z`,
               caller: "codex",
               tool: "jev_decide",
               model: "m",
               durationMs: 100 + minute,
               inputTokens: 10,
               outputTokens: 0,
               status: minute % 2 === 0 ? "success" : "error",
               errorCategory: minute % 2 === 0 ? null : "JEV_TIMEOUT",
               errorMessage: null,
                  });
               }
      const points = db.requests.timeline(
            "2026-09-26T10:00:00Z",
            "2026-09-26T10:10:00Z",
            120,
            );
      expect(points.length).toBeGreaterThan(0);
      const totalSuccess = points.reduce((sum, p) => sum + p.success, 0);
      const totalFailed = points.reduce((sum, p) => sum + p.failed, 0);
      expect(totalSuccess + totalFailed).toBe(6);
        });

   it("groups by caller and finds the most used tool", () => {
      const db = newDb();
      const timestamps = ["10:00", "10:01", "10:02", "10:03"];
      timestamps.forEach((t, index) => {
            db.requests.insert({
               requestId: `g${index}`,
               timestamp: `2026-09-26T${t}:00.000Z`,
               caller: "codex",
               tool: index < 3 ? "jev_route_task" : "jev_decide",
               model: "m",
               durationMs: 50,
               inputTokens: 5,
               outputTokens: 0,
               status: "success",
               errorCategory: null,
               errorMessage: null,
                  });
               });
      const groups = db.requests.groupByColumn("caller", "2026-09-26T00:00:00Z", "2026-09-27T00:00:00Z");
      expect(groups[0]?.key).toBe("codex");
      expect(groups[0]?.count).toBe(4);
      expect(db.requests.mostUsedToolForCaller("codex", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z"))
            .toBe("jev_route_task");
        });
});

describe("LogRepository", () => {
   it("stores redacted context and filters by level", () => {
      const db = newDb();
      db.logs.insert({
         timestamp: new Date().toISOString(),
         level: "error",
         component: "jev",
         message: "connection failed for dk-secretivevalue123456",
         context: { apiKey: "dk-anothersecret12345678", url: "https://api.defapi.org/v1/systemone" },
            });
      db.logs.insert({
         timestamp: new Date().toISOString(),
         level: "info",
         component: "api",
         message: "server listening",
            });
      const errors = db.logs.list({ level: "error" });
      expect(errors.total).toBe(1);
      const record = errors.records[0];
      expect(record?.message).not.toContain("secretivevalue123456");
      expect(record?.context?.apiKey).not.toBe("dk-anothersecret12345678");
      expect(typeof record?.context?.apiKey).toBe("string");
      expect(String(record?.context?.apiKey)).toContain("****");
       });
});

describe("ConnectionEventRepository", () => {
   it("tracks disconnects, last success and last failure", () => {
      const db = newDb();
      db.connectionEvents.insert("disconnected", "HTTP 503", 503);
      db.connectionEvents.insert("auth_failure", "HTTP 401", 401);
      db.connectionEvents.insert("recovered", null, null);

      expect(db.connectionEvents.totalDisconnects()).toBe(2);
      const lastFailure = db.connectionEvents.lastFailure();
      expect(lastFailure?.state).toBe("auth_failure");
      expect(lastFailure?.statusCode).toBe(401);
      expect(db.connectionEvents.lastSuccessAt()).not.toBeNull();
       });
});

describe("SettingsRepository", () => {
   it("saves, overwrites and deletes settings", () => {
      const db = newDb();
      db.settings.set("ui.defaultTimeRange", "30d");
      expect(db.settings.get<string>("ui.defaultTimeRange")).toBe("30d");
      db.settings.set("ui.defaultTimeRange", "7d");
      expect(db.settings.get<string>("ui.defaultTimeRange")).toBe("7d");
      db.settings.delete("ui.defaultTimeRange");
      expect(db.settings.get("ui.defaultTimeRange")).toBeUndefined();
        });
});

describe("ApiKeyStore", () => {
   it("round-trips the key, masks it in info() and clears it", () => {
      const db = newDb();
      db.apiKeys.save("dk-testkeyabcdefghij9999");
      expect(db.apiKeys.get()).toBe("dk-testkeyabcdefghij9999");
      const info = db.apiKeys.info();
      expect(info?.masked).toMatch(/^dk-\*+9999$/);
      expect(info?.masked).not.toContain("testkeyabcdefghij");
      db.apiKeys.clear();
      expect(db.apiKeys.get()).toBeUndefined();
      expect(db.apiKeys.info()).toBeUndefined();
        });

   it("masks short keys entirely", () => {
      expect(maskApiKey("short")).toBe("*".repeat(24));
        });
});

describe("retention", () => {
   it("purges rows older than the configured window", () => {
      const db = newDb();
      const now = new Date("2026-09-26T12:00:00Z");
      const recent = new Date(now.getTime() - 60_000).toISOString();
      const old = new Date(now.getTime() - 400 * 86_400_000).toISOString();
      for (const timestamp of [recent, old]) {
            db.requests.insert({
               requestId: `p-${timestamp}`,
               timestamp,
               caller: "codex",
               tool: "jev_decide",
               model: "m",
               durationMs: 10,
               inputTokens: 1,
               outputTokens: 0,
               status: "success",
               errorCategory: null,
               errorMessage: null,
                  });
            db.logs.insert({ timestamp, level: "info", component: "api", message: "hello" });
            db.connectionEvents.insert("disconnected", "x", null, timestamp);
               }
      const result = db.applyRetention(
            { ...DEFAULT_SETTINGS, storage: { ...DEFAULT_SETTINGS.storage, retentionDays: 30 } },
            now,
            );
      expect(result.requestsDeleted).toBe(1);
      expect(result.logsDeleted).toBe(1);
      expect(result.connectionEventsDeleted).toBe(1);
        });

   it("keeps everything when retention is unlimited", () => {
      const db = newDb();
      db.requests.insert({
         requestId: "forever",
         timestamp: "2020-01-01T00:00:00.000Z",
         caller: "codex",
         tool: "jev_decide",
         model: null,
         durationMs: 1,
         inputTokens: null,
         outputTokens: null,
         status: "success",
         errorCategory: null,
         errorMessage: null,
            });
      const result = db.applyRetention(
            { ...DEFAULT_SETTINGS, storage: { ...DEFAULT_SETTINGS.storage, retentionDays: 0 } },
            new Date(),
            );
      expect(result.requestsDeleted).toBe(0);
        });
});
