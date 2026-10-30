# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ARG PNPM_VERSION=10.18.3

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate

COPY . .

RUN pnpm --filter @workspace/api-server... \
    --filter @workspace/ai-trading... \
    install --frozen-lockfile

RUN pnpm --filter @workspace/ai-trading run build \
    && pnpm --filter @workspace/api-server run build


FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=5000
ENV STATIC_DIR=/app/artifacts/ai-trading/dist/public

WORKDIR /app

COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=build --chown=node:node /workspace/artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY --from=build --chown=node:node /workspace/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build --chown=node:node /workspace/artifacts/ai-trading/dist/public ./artifacts/ai-trading/dist/public

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/healthz').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
