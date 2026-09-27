# JevAI-MCP - internal MCP server + dashboard for the Jev decision model.
# Build: docker build -t jevai-mcp:1.0.0 .
# Run: docker run -p 8080:8080 -p 3001:3001 -e DEFAPI_API_KEY=dk-... -v jevai-data:/data jevai-mcp:1.0.0

FROM node:22 AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/jev-client/package.json packages/jev-client/
COPY packages/database/package.json packages/database/
COPY packages/mcp-tools/package.json packages/mcp-tools/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm ci --no-audit --no-fund

COPY packages packages
COPY apps/server apps/server
COPY apps/web apps/web

ARG APP_VERSION=1.0.0
ARG GIT_COMMIT=
ARG BUILD_DATE=
ENV APP_VERSION=$APP_VERSION GIT_COMMIT=$GIT_COMMIT BUILD_DATE=$BUILD_DATE
ENV npm_config_ignorescripts=false

RUN npm run build -w apps/web \
	&& node apps/server/scripts/build.mjs \
	&& npm prune --omit=dev

FROM node:22 AS runtime
LABEL org.opencontainers.image.title="JevAI-MCP" \
	org.opencontainers.image.description="Internal MCP server and dashboard that connects AI coding agents to the Jev decision model through DefAPI." \
	org.opencontainers.image.source="https://github.com/gamedirection/jevai-mcp" \
	org.opencontainers.image.licenses="MIT"

WORKDIR /app
ENV NODE_ENV=production \
	PORT=8080 \
	MCP_PORT=3001 \
	DATABASE_PATH=/data/jevai.db \
	NODE_OPTIONS=--max-old-space-size=512

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8080 3001
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:8080/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--env-file-if-exists=/app/.env", "apps/server/dist/server.js"]
