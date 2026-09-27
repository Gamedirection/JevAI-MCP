# HTTP API reference

Base URL is the server port (default `8080`). All JSON responses use one
envelope:

```json
{ "success": true, "data": ... }
{ "success": false, "error": { "message": "...", "details": ... } }
```

Write requests (POST/PUT/DELETE) require `Origin` to match `Host` when the
`Origin` header is present, and bodies are limited to 1 MB.

## Health and meta

| Method | Path                        | Notes                                                  |
| ------ | -------------------------- | ----------------------------------------------------- |
| GET     | `/health`                    | Status healthy, degraded or unhealthy. 200 unless DB down |
| GET     | `/health/live`             | Liveness. Never touches Jev or DB                      |
| GET     | `/health/ready`            | Readiness. DB only                                     |
| GET     | `/metrics`                 | Prometheus text format                                 |
| GET     | `/version`, `/api/version` | `version`, `commit`, `buildDate`                        |
| GET     | `/api/bootstrap`           | Version, default time range, thresholds, savings config |

## Dashboard and data

| Method | Path                       | Parameters                                                                 |
| ------ | -------------------------- | -------------------------------------------------------------------------- |
| GET     | `/api/dashboard`           | `range=today / 7d / 30d / month / year / custom`, `from`, `to`                         |
| GET     | `/api/overview/thresholds` | -  (example guidance levels)                                                  |
| GET     | `/api/requests`            | `range,from,to,caller,tool,status,model,search,limit(<=500),offset`          |
| GET     | `/api/requests/facets`      | -  (distinct caller/tool/model values)                                         |
| GET     | `/api/requests/:id`         | detail; `state` and `response` only if the storage policy allows             |
| GET     | `/api/agents`              | `range,from,to`                                                              |
| GET     | `/api/logs`                | `level,component,search,from,to,limit,offset,after` (after -> `live` rows)    |
| GET     | `/api/logs/download`       | `format=json or text` plus the same filters                                     |

## Settings

| Method  | Path                     | Notes                                                              |
| ------- | ------------------------ | ------------------------------------------------------------------- |
| GET      | `/api/settings`          | Redacted settings + `apiKeySource` + `envOverrideKeys` + `mcpUrl`    |
| PUT      | `/api/settings`          | Body `{settings: {...}}`. Partial sections merge. 422 lists issues   |
| POST     | `/api/settings/api-key`  | Body `{apiKey}`. 409 when an env key is active                       |
| DELETE  | `/api/settings/api-key`  | Removes the stored key. 409 for env keys                             |
| POST     | `/api/settings/reset`    | Restores defaults                                                    |
| POST     | `/api/system/test-jev-connection` | Real small decision against Jev. 502 on failure with `error.type`|
| POST     | `/api/system/run-retention`      | Runs retention now, returns delete counts                    |

## Integrations

| Method | Path                                | Notes                                              |
| ------ | ----------------------------------- | --------------------------------------------------- |
| GET     | `/api/integrations`                 | All guides with file lists and last-call times       |
| GET     | `/api/integrations/:id/file/:file`  | Preview one generated file                           |
| GET     | `/api/integrations/:id/download`    | ZIP for codex, claude, opencode, gemini or generic   |
| GET     | `/api/integrations/download-all`    | Every guide in one ZIP                               |
| POST     | `/api/integrations/test-decision`   | Body `{state, question, options[]}`. Runs one real decision |
| POST     | `/api/mcp/probe/:tool`               | Body = raw tool arguments. Returns the exact MCP payload |

## System

| Method | Path                              | Notes                                          |
| ------ | -------------------------------- | ----------------------------------------------- |
| GET     | `/api/system/status`             | App, Jev, MCP, database and memory state          |
| GET     | `/api/system/connection-events` | `limit` (default 100). State-change history       |
| GET     | `/api/system/diagnostics`        | JSON with `?format=json`, otherwise a ZIP. Secrets are redacted |

## MCP

`POST /mcp` (on the API port and on `MCP_PORT`). Streamable HTTP with
sessions: capture the `Mcp-Session-Id` response header from `initialize` and
send it on later requests. Unknown session ids get 404. Delete the session
with `DELETE /mcp`. The endpoint returns JSON; SSE is supported per the
specification for servers that need it, not for GET streams.
