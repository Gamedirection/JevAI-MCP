# JevAI-MCP

JevAI-MCP is an internal server that connects AI coding agents to the Jev
decision model. Jev answers structured questions fast and cheap: classify a
task, pick a strategy, rate complexity, decide whether to escalate. The server
exposes Jev through the Model Context Protocol (MCP) and records every
decision in a local dashboard.

The server ships two things in one container:
- an MCP server your agents connect to at `/mcp`
- a web dashboard at `/` that shows usage, agents, logs and settings

This project has no login. It is built for a private network. Do not expose it
directly to the public internet. See [Security](#security).

---

## Quickstart

1. Get a DefAPI key. Keys start with `dk-`. See https://defapi.org.

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Put your key into `.env`:

   ```
   DEFAPI_API_KEY=dk-your-key-here
   ```

4. Run with Docker Compose:

   ```bash
   docker compose up --build -d
   ```

5. Open the dashboard: http://localhost:8080

6. Open the **Integrations** page and download the ZIP for your agent. Each
   ZIP contains ready-to-use configuration and routing instructions that
   already contain the MCP URL you configured in Settings.

7. Copy the MCP endpoint into your agent configuration. For example:

   ```bash
   # Codex
   codex mcp add jevai --url http://localhost:3001/mcp

   # Claude Code
   claude mcp add --transport http jevai http://localhost:3001/mcp
   ```

8. Ask your agent to classify a task. It should call `jev_route_task`.

---

## What the server does

Agents call five MCP tools. The server builds the Jev questions, calls the
DefAPI gateway, applies the confidence thresholds, and stores the result.

| Tool                  | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `jev_decide`          | Answer one or more custom questions about one state        |
| `jev_route_task`      | Classify a coding task (bug, feature, refactor, docs, ...)  |
| `jev_assess_complexity` | Rate a change on the five-level complexity scale          |
| `jev_should_escalate` | Decide whether a task needs deeper reasoning or a human    |
| `jev_choose_strategy` | Pick a strategy from your own list of options              |

Jev calls happen at `POST {endpoint}/systemone`. See
[Jev integration](#jev-integration) below.

---

## Core principles

**Jev is an optimization, not a dependency.** If Jev, DefAPI, or this server
is unavailable, every tool returns a structured failure:

```json
{ "success": false, "error": { "type": "JEV_UNAVAILABLE", "retryable": true, "message": "..." } }
```

The agent instructions that ship with each integration tell agents to keep
working with their normal reasoning in that case. The health endpoint returns
`200` with `status: degraded`, never `503`, so a DefAPI outage does not stop
agents from working.

**Fail open.** The dashboard, health checks and the MCP endpoint keep serving
while the upstream is down.

**Least content stored.** By default the server stores metadata only: sizes,
counts, timing, caller, tool, status. The exact prompt content is not stored
until you turn full storage on in Settings → Privacy.

---

## Dashboard pages

| Page           | Contents                                                        |
| -------------- | --------------------------------------------------------------- |
| Dashboard      | Calls over time, success rate, latency, tokens, per-tool and per-agent bars |
| Requests       | Every Jev call, with filters and a detail view                  |
| Agents         | Which agents called the server, their most used tool, last seen |
| Logs           | Application log stream, live tailing, text/JSON download         |
| Integrations   | Step-by-step setup and per-agent ZIP downloads                  |
| Settings       | Jev connection, MCP, privacy and retention, URL for downloads   |
| System         | Version, runtime state, connection events, diagnostics ZIP      |

The footer shows the running version, commit and build date.

---

## Configuration

Two layers exist. Environment variables win over values saved on the Settings
page. The Settings page marks each field that an environment variable locks.

All variables are listed in [.env.example](.env.example). Key ones:

| Variable                | Default                     | Meaning                                  |
| ----------------------- | --------------------------- | ---------------------------------------- |
| `DEFAPI_API_KEY`        | -                            | DefAPI key. Store it here or on Settings  |
| `DEFAPI_API_ENDPOINT`   | `https://api.defapi.org/v1` | Gateway base URL                          |
| `JEV_MODEL`             | `typesafe/jev-1.13`         | Decision model                            |
| `PORT`                  | `8080`                      | HTTP: dashboard, API, `/mcp`, `/metrics`   |
| `MCP_PORT`              | `3001`                      | Second, MCP-only port                     |
| `MCP_ENABLED`           | `true`                      | Turn the MCP endpoints on or off          |
| `DATABASE_PATH`         | `./data/jevai.db`           | SQLite file. In Docker: `/data/jevai.db`   |
| `DATA_RETENTION_DAYS`   | `365`                       | Days to keep requests. `0` = never delete |
| `LOG_RETENTION_DAYS`    | `14`                        | Days to keep log lines                    |
| `REQUEST_STATE_STORAGE` | `metadata_only`             | `off`, `metadata_only` or `full`          |
| `STORE_JEV_RESPONSES`   | `true`                      | Store the answers Jev returns             |
| `LOG_LEVEL`             | `info`                      | `debug`, `info`, `warn`, `error`          |
| `PUBLIC_PROTOCOL`       | `http`                      | Protocol written into downloads           |
| `PUBLIC_HOSTNAME`       | `localhost`                 | Hostname written into downloads           |
| `PUBLIC_MCP_PORT`       | `3001`                      | Port written into downloads               |

Settings that you change without a restart take effect immediately. The server
picks up retention settings on an hourly run, and you can run retention by
hand on the System page.

---

## HTTP endpoints

Server root port: `PORT` (default `8080`).

| Method | Path                     | Purpose                                   |
| ------ | ------------------------ | ----------------------------------------- |
| `POST` | `/mcp`                   | The MCP endpoint for agents               |
| `GET`  | `/health`                | Health summary. `200` unless the database is down |
| `GET`  | `/health/live`           | Liveness probe                             |
| `GET`  | `/health/ready`          | Readiness probe (database)                 |
| `GET`  | `/metrics`               | Prometheus metrics                         |
| `GET`  | `/version`, `/api/version` | Version and commit                      |
| `GET`  | `/api/bootstrap`         | One call with version, defaults, thresholds |
| `GET`  | `/api/dashboard`         | Dashboard payload for a time range         |
| `GET`  | `/api/requests`          | Request list with filters                  |
| `GET`  | `/api/logs`              | Log list with filters                      |
| `GET`  | `/api/agents`            | Per-agent stats                            |
| `GET/PUT/POST/DELETE` | `/api/settings...` | Read and change settings                 |
| `GET`  | `/api/integrations...`   | Guides, file previews, ZIP downloads       |

A second MCP server runs on `MCP_PORT` (default `3001`) with `/mcp` only.
Use one or the other depending on how you expose the service.

---

## Metric families

Named `jevai_*`. Labels stay low-cardinality on purpose: caller, tool, status,
route, error category. You will never see request ids or repository names as
metric labels. `GET /metrics` returns Prometheus text format.

Examples: `jevai_requests_total`, `jevai_requests_success_total`,
`jevai_request_duration_seconds`, `jevai_http_requests_total`,
`jevai_http_duration_seconds`, `jevai_active_clients`, `jevai_upstream_up`,
`jevai_database_size_bytes`.

---

## Jev integration

The server talks to the DefAPI gateway:

```
POST https://api.defapi.org/v1/systemone
Authorization: Bearer dk-...
Content-Type: application/json

{
   "model": "typesafe/jev-1.13",
   "state": "One paragraph of context the agent is working on.",
   "questions": {
       "subsystem": { "type": "choice", "instructions": "...", "criteria": { "application": null, "ingress": null } },
       "risk":       { "type": "score",  "instructions": "...", "criteria": ["minimal", "low", "moderate", "high", "critical"] },
       "urgent":     { "type": "noul",  "instructions": "..." }
   }
}
```

Question types:
- `choice` -  one option out of a fixed set
- `score` -  an ordered scale (2 to 10 levels)
- `noul` -  a yes/no call probability

Answers carry a `confidence`. The server maps it to a guidance level:

| Confidence      | Guidance      | What the agent should do             |
| --------------- | ------------- | ------------------------------------ |
| >= 0.80        | `use`         | Follow the answer                     |
| 0.55 to 0.79     | `guidance`    | Treat it as advice                    |
| < 0.55          | `independent` | Decide on your own                    |

`noul` verdicts follow the same idea: `0.80` or higher means yes, `0.20` or
lower means no, and everything in between is `agent_decides`.

Transient failures (408, 425, 429, 500, 502, 503, 504, 529) retry with
exponential backoff and jitter, and they honor `Retry-After`. Validation,
authentication and bad-request errors do not retry.

---

## Agent setup

The Integrations page renders the same steps and the same ZIP files for all
five targets. The repository keeps plain copies under
[`integrations/`](integrations). Set `PUBLIC_HOSTNAME` and `PUBLIC_MCP_PORT`
so the generated configuration matches your deployment.

The `integrations/` copies use `http://localhost:3001`. Regenerate them after
guidance changes:

```bash
npm run generate:integrations
```

The ZIPs the server creates use the live URL you saved in Settings.

### Codex

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.jevai]
url = "http://localhost:3001/mcp"
```

Or with the CLI: `codex mcp add jevai --url http://localhost:3001/mcp`.
Put the routing policy from `integrations/codex/jev-routing.md` into your
`AGENTS.md`.

### Claude Code

One project:

```json
{
   "mcpServers": {
       "jevai": { "type": "http", "url": "http://localhost:3001/mcp" }
   }
}
```

`.mcp.json` needs the `"type": "http"` key, or Claude treats it as stdio.
CLI form: `claude mcp add --transport http jevai http://localhost:3001/mcp`.
Put the routing policy into `CLAUDE.md`.

### OpenCode

In `opencode.json`:

```json
{
   "mcp": {
       "jevai": { "type": "remote", "url": "http://localhost:3001/mcp", "enabled": true, "oauth": false }
   }
}
```

### Gemini CLI

`gemini mcp add --transport http -s user jevai http://localhost:3001/mcp`.
In `~/.gemini/settings.json` the key is `httpUrl`, not `url`:

```json
{
   "mcpServers": {
       "jevai": { "httpUrl": "http://localhost:3001/mcp", "timeout": 30000 }
   }
}
```

### Agents that send their own name

Set the header `X-Jev-Caller: <name>` on the MCP connection, or send
`metadata` with `caller`, `client_version`, `project`, `repository` and
`session_id` in tool calls. Agents you do not recognise show up under the
caller they send, and the Agents page marks them as custom.

---

## Development

```bash
npm install
cp .env.example .env      # put DEFAPI_API_KEY in .env
npm run dev
```

`npm run dev` starts three things: an esbuild watcher for the server, Vite for
the dashboard on http://5173 (it proxies `/api`, `/mcp`, `/metrics` and
`/health` to the server on `:8080`), and the server itself.

Other commands:

```bash
npm test                  # vitest: node + web projects (77 backend + 8 dashboard tests)
npm run typecheck         # tsc --noEmit for each workspace
npm run lint              # eslint
npm run build             # web bundle + server esbuild bundle
npm run clean             # remove dist folders and local caches
npm run backup            # online-safe SQLite backup into ./backups
npm run restore <path>    # restore a backup after integrity checks
npm run helm:lint
```

Node 22 or newer is required (`better-sqlite3` prebuilds and the `node:`
imports). Tests: `npx vitest run --project node` runs only backend tests.

Real end-to-end calls to Jev (`packages/jev-client/src/real-api.test.ts`) are
skipped unless you export both `JEV_REAL_TESTS=1` and `DEFAPI_API_KEY`.
This keeps `npm test` offline and free by default.

---

## Deployment

### Docker

```bash
docker build -t jevai-mcp:1.0.0 .
docker run -p 8080:8080 -p 3001:3001 \
    -e DEFAPI_API_KEY=dk-... \
    -e PUBLIC_HOSTNAME=yourhost.internal \
    -v jevai-data:/data \
    jevai-mcp:1.0.0
```

The image runs as a non-root user with a read-only root filesystem and a
healthcheck. `/data` holds the SQLite database. A host volume is enough; the
database needs no external service.

### Kubernetes

```bash
kubectl create secret generic jevai-mcp-secrets --from-literal=DEFAPI_API_KEY=dk-...
kubectl apply -f kubernetes/
```

The plain manifests keep one replica with `Recreate` because SQLite runs on a
`ReadWriteOnce` volume. Probes point at `/health/live` and `/health/ready`.

### Helm

```bash
helm install jevai ./helm/jevai-mcp \
    --set jevaiApiKey=dk-... \
    --set integration.publicHostname=mcp.internal.example
```

`ingress.enabled` is `false` by default on purpose (no login). If you enable
it, put an authenticating proxy or VPN in front. The chart fails on
`replicaCount != 1` and on bad privacy settings. It sets a `checksum/config`
pod annotation so a ConfigMap change restarts the pod.

---

## Operations

**Back up.** Stop the container or use the online-safe script, then store the
file:

```bash
npm run backup /backups            # uses better-sqlite3 backup API
DATABASE_PATH=/data/jevai.db ./scripts/backup.sh /backups
```

**Restore** takes the backup path and keeps the current database at
`<path>.before-restore`:

```bash
npm run restore /backups/jevai-20260926T101010Z.db
```

**Retention** deletes old rows on startup and every hour. The System page has
a "Run retention now" button and `POST /api/system/run-retention`.

**Diagnostics** bundles settings, health, connection history and logs into a
ZIP with redactions. The API key never appears in it. Download from the System
page or `GET /api/system/diagnostics`.

**API keys.** Keys go through `DEFAPI_API_KEY` (recommended) or the database
through Settings. In the database the key is hashed and shown masked
(`dk-****abcd`). A key from the environment cannot be removed on the Settings
page; the page tells you to unset the variable.

---

## Security
- **No login.** Internal tool only. Keep it inside the private network, a
        VPN, or behind an identity-aware proxy. Both Docker and Helm keep it
        `ClusterIP` / no ingress by default for this reason.
- **Secrets in transit and at rest.** TLS to DefAPI; no key in logs,
  metrics, errors, ZIP downloads or the diagnostics bundle. Request
  error messages are redacted before storage.
- **Headers.** The server sends `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, a strict `Content-Security-Policy`,
  `Referrer-Policy` and `Permissions-Policy`, and blocks cross-origin
  writes by comparing `Origin` to `Host`.
- **Input limits.** JSON bodies are size-limited, and metric labels are
  bounded to low-cardinality values.

If you expose this anywhere users can reach, add an auth proxy and also set a
strong `PUBLIC_HOSTNAME` so the downloads do not invite credential-stuffing
against the wrong URL.

---

## Project layout

```
apps/server        Hono HTTP + MCP server (API routes under src/routes)
apps/web           React dashboard (pages under src/pages)
packages/jev-client  The DefAPI HTTP client: retries, errors, connection state
packages/database  SQLite access: repositories, migrations, retention, key store
packages/mcp-tools The five MCP tools: schema, question builders, fail-open
packages/shared    Settings, types, wiring, time ranges, constants
integrations/      Plain copies of the files each agent ZIP contains
scripts/           dev, clean, backup, restore, guide generator
kubernetes/        Plain manifests (secret, pvc, deployment, service)
helm/jevai-mcp      Helm chart with the same content plus ingress off by default
.github, .gitlab-ci.yml  CI: lint, typecheck, test, build, docker, helm
```

## License

MIT. See [LICENSE](LICENSE).

## Related
- [Jev decision model](https://jev.sh) -  the model behind the decisions
- [DefAPI gateway](https://defapi.org) -  how you reach it
- [Model Context Protocol](https://modelcontextprotocol.io) -  the protocol
