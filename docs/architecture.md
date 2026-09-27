# Architecture

JevAI-MCP is one Node process with two servers and one SQLite file.

```
AI coding agents (Codex, Claude Code, OpenCode, Gemini CLI, ...)
        |  MCP over Streamable HTTP (/mcp)
        v
+---------------------------------------------------------------+
| apps/server (Hono)                                            |
|                                                               |
|  MCP endpoint ---- packages/mcp-tools ---- packages/jev-client|
|  API routes  ----- repositories ---------- packages/database  |
|  static files ---- apps/web/dist (built React dashboard)      |
+---------------------------------------------------------------+
        |                                          |
        v                                          v
   DefAPI gateway (POST /systemone)            SQLite file
   typesafe/jev-1.13                          /data/jevai.db
```

## Workspaces

| Package               | Responsibility                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `packages/shared`      | Settings schema, defaults, env overrides, wire types, constants    |
| `packages/jev-client`  | The one place that calls DefAPI. Timeouts, retries, error mapping   |
| `packages/database`    | Migrations, repositories, retention, hashed API key store           |
| `packages/mcp-tools`   | The five tool definitions and `handleToolCall`                       |
| `apps/server`          | Hono app, routes, MCP session manager, metrics, logger, wiring      |
| `apps/web`             | React dashboard. Talks only to `/api/*`                              |

Dependencies point one way: server -> tools/client/database -> shared. The
dashboard imports only types from `@jevai/shared`. No package imports the
server.

## Request lifecycle (one decision)

1. The agent POSTs `tools/call` to `/mcp`. `mcp-server.ts` identifies the
   caller (explicit `X-Jev-Caller` header, then origin or user-agent sniffing,
   then `metadata.caller` in the arguments).
2. The SDK validates arguments against the tool's zod schema.
3. `handleToolCall` in `packages/mcp-tools/src/tools.ts` builds the Jev
   questions and calls `jev-client`.
4. `jev-client` POSTs `{model, state, questions}` to
   `{endpoint}/systemone` with the bearer key. Transient failures retry with
   exponential backoff and jitter; `Retry-After` is honored.
5. Answers come back. `handleToolCall` attaches a guidance level or noul
   verdict from the confidence thresholds.
6. A row goes into `requests` through `ToolCallRecord`, shaped by the privacy
   settings (off / metadata_only / full for the state; responses on or off).
7. The agent receives `structuredContent` plus a JSON text fallback. On any
   Jev failure it receives `{success: false, error: {...}}` with
   `isError: true`. The handler never throws.

## Fail-open design

Nothing on the request path can block agent work:

- Tool handlers return structured errors instead of throwing.
- `/health` returns 200 with `status: degraded` when Jev is down. Only a
  dead database returns 503.
- `/health/live` never depends on Jev. `/health/ready` depends only on the
  database.
- The dashboard renders "last failure" information instead of blank screens
  when the upstream is down.
- The bundled agent instructions tell agents to continue with their own
  reasoning whenever `success` is false.

## Storage model

`requests`, `logs`, `connection_events`, `settings` and `schema_migrations`
in one SQLite file with WAL. `better-sqlite3` runs synchronous=NORMAL, which
is safe for this write volume and keeps decisions fast. The `Database` facade
in `packages/database/src/index.ts` is the only entry point. Replacing SQLite
with a server database later means new repository implementations, not new
call sites.

The same `isoTimestamp()` helper normalizes every time value written or
compared in SQL, so string comparisons against ISO boundaries stay correct.

## Metrics and labels

The metrics registry (`apps/server/src/metrics.ts`) is a small hand-written
Prometheus text renderer. Allowed labels are bounded enums: caller (known
callers plus `other`), tool (the five names), status class, route pattern,
error category. Request ids, session ids and repository names are rejected
from labels at the type level, which prevents cardinality blowups.

## Identity and privacy boundaries

- The DefAPI key exists in exactly two places: the environment, or hashed
  in the `settings` table. It is never returned by any endpoint.
- Error text and log context pass through `redactText()` before storage.
- `requests.state_json` and `response_json` follow the configured storage
  mode. Question text counts as content.
