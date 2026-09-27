# Deployment guide

JevAI-MCP has no login. Deploy it somewhere your team already trusts. The
default Docker and Kubernetes configurations keep it off the public internet.

## Ports

| Port | Env                  | Serves                                              |
| ---- | ------------------- | --------------------------------------------------- |
| 8080  | `PORT`               | Dashboard, `/api`, `/metrics`, `/health`, and `/mcp` |
| 3001 | `MCP_PORT`           | A second `/mcp`-only listener (optional)              |

Agents can use either MCP endpoint. Point `PUBLIC_HOSTNAME` and
`PUBLIC_MCP_PORT` at the address agents reach, not necessarily the internal
one. If you change the settings on the Settings page, the ZIP downloads follow
the new URL.

## Docker Compose (single host)

```bash
git clone <this repository> && cd jevai-mcp
cp .env.example .env       # set DEFAPI_API_KEY
docker compose up --build -d
```

Data lives in the named volume `jevai-data` mounted at `/data`. Backups use
the online-safe backup API through the included scripts. Copy the file out,
then take a verified backup:

```bash
docker compose cp jevai-mcp:/data/jevai.db ./stage.db
DATABASE_PATH=./stage.db npm run backup ./backups
```

## Kubernetes (plain manifests)

```bash
kubectl create secret generic jevai-mcp-secrets \
     --from-literal=DEFAPI_API_KEY=dk-...
# Edit kubernetes/deployment.yaml: set YOUR-HOSTNAME to the address agents use
kubectl apply -f kubernetes/deployment.yaml -f kubernetes/pvc.yaml -f kubernetes/service.yaml
```

One replica with `Recreate`; SQLite lives on a ReadWriteOnce volume. The
container runs as uid 1000 with `readOnlyRootFilesystem` and drops all
capabilities. Only `/data` and `/tmp` are writable.

## Helm (recommended for clusters)

```bash
helm upgrade --install jevai ./helm/jevai-mcp \
     --namespace jevai --create-namespace \
     --set jevaiApiKey=dk-... \
     --set integration.publicHostname=mcp.internal.example \
     --set image.repository=registry.internal/jevai-mcp
```

Useful values (full list in `helm/jevai-mcp/values.yaml`):

- `jevaiApiKey` or `existingSecret` + `apiKeySecretKey`
- `image.repository`, `image.tag` (defaults to the chart app version)
- `persistence.size`, `persistence.storageClass`
- `integration.publicProtocol/publicHostname/publicPort` -  the URL baked
  into every downloaded agent configuration
- `dashboard.*` for retention, storage mode, refresh interval
- `ingress.enabled` (false) with `ingress.hostname` -  add an authentication
  layer before enabling it

The chart refuses to render with `replicaCount > 1` or an invalid
`requestStateStorage`.

## Reverse proxy

Terminate TLS at your proxy and forward to port 8080. The MCP transport uses
plain request/response POSTs, so no special WebSocket or sticky-session
handling is needed. Forward these client headers if you want better caller
identification: `X-Jev-Caller`, `Origin`, `User-Agent`.

## CI/CD

Both pipelines run the same gates: install, lint, typecheck, tests, web build,
server bundle, Docker build with a container smoke test, and Helm
lint/template (GitHub Actions) or lint/template/package (GitLab CI). Copy the
image to your registry from the `docker` job artifacts or add a push step.
