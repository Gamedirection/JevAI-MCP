# Operations

## Health checks

- `/health/live` -  does the process respond. Use for liveness probes.
- `/health/ready` -  is the database open. Use for readiness probes.
- `/health` -  summary of app, Jev, database and MCP state. Use for humans
  and monitors that want detail; returns 200 with `degraded` while Jev
  is down so agents keep working.

## Prometheus

Scrape `/metrics`. Families are named `jevai_*`. Labels are bounded: caller,
tool, route, status, error category. Useful alerts:

- `jevai_upstream_up == 0` for more than 10 minutes -  DefAPI is down. Agents
  keep working, but they lose their fast decisions.
- `jevai_requests_total{status="error"}` growth with
  `error="JEV_AUTH_FAILURE"` -  the API key broke or expired.
- `jevai_database_size_bytes` growth beyond your volume budget -  run
  retention or lower `DATA_RETENTION_DAYS`.

## Backups

Take online-safe backups with the backup API (safe while the server runs):

```bash
npm run backup /backups
DATABASE_PATH=/data/jevai.db node scripts/backup.mjs /backups
./scripts/backup.sh /backups
```

Inside a container: `docker compose cp jevai-mcp:/data/jevai.db ./copy.db`,
then verify the copy on the host. Restore stops on a failed integrity check or
a missing table, and saves the live database at
`<path>.before-restore` first:

```bash
npm run restore /backups/jevai-....db
```

## Retention

The server applies retention on startup and every hour. You can also press
the button on the System page or POST `/api/system/run-retention`.

- Requests and connection events: `DATA_RETENTION_DAYS` (0 keeps forever)
- Logs: `LOG_RETENTION_DAYS`

## Diagnostics

Download from the System page or `GET /api/system/diagnostics` (ZIP). With
`?format=json` you get the same bundle inline. It contains version, redacted
configuration, connection history, database statistics, and recent errors and
warnings. The API key is never in it.

## Common failures

| Symptom                                   | Cause and fix                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Dashboard shows Jev `disconnected`        | Key missing, endpoint wrong, or egress blocked. Check `apiKeySource` on Settings/Status: `none`, `database`, `environment`. Test connection from Settings |
| Error `JEV_AUTH_FAILURE`                 | The key is wrong or expired. Replace it. The server does not retry these               |
| Error `JEV_RATE_LIMITED`                  | Upstream throttling (429). The client honors `Retry-After` and backs off               |
| Agents cannot connect                     | Wrong URL in their config. Compare with the URL printed on the Integrations page       |
| Agent "not recognised" on Agents page     | The client sends no caller hint. Set `X-Jev-Caller` or add the metadata block          |
| Settings field greyed with an "env" pill | An environment variable overrides it -  change the variable, not the page               |
| Request detail shows state hidden         | Expected: privacy mode is `off` or `metadata_only`. Enable `full` to store content     |

## Runbooks

**Replace the DefAPI key with a database-stored key.** Unset `DEFAPI_API_KEY`
in the environment, restart, then save the key once on Settings → DefAPI key.
It is hashed and never shown again. Remove it with the Remove key button.

**Move data to a new instance.** Stop the old server, copy `jevai.db` (or
restore a backup) to the new `/data`, and start. Nothing else is required.

**Bulk export for analysis.** `GET /api/requests?limit=...`,
`/api/logs/download?format=json`, and `/metrics` cover requests, logs and
aggregates. There is no external analytics service; the SQLite file is the
record of truth.
