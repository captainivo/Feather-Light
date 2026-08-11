# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS granite-build
WORKDIR /build/granite-wing
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS river-build
WORKDIR /build/river-slate
COPY services/river-slate/package.json services/river-slate/package-lock.json ./
RUN npm ci
COPY services/river-slate/tsconfig.json ./
COPY services/river-slate/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS shard-build
WORKDIR /build/shard-lantern
COPY services/shard-lantern/package.json services/shard-lantern/package-lock.json ./
RUN npm ci
COPY services/shard-lantern/tsconfig.json ./
COPY services/shard-lantern/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    FEATHER_LIGHT_CONFIG=/etc/feather-light/config.yaml \
    FEATHER_LIGHT_DB=/var/lib/feather-light/feather-light.sqlite3 \
    HEALTH_CARD_DIR=/var/lib/river-slate/health-card \
    AUTHORA_API_BASE_URL=http://127.0.0.1:8421 \
    SHARD_LANTERN_DB=/var/lib/shard-lantern/shard-lantern.sqlite3 \
    GRANITE_WING_URL=http://127.0.0.1:8765
WORKDIR /app
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client \
  && rm -rf /var/lib/apt/lists/*
COPY --from=granite-build --chown=node:node /build/granite-wing/package.json /build/granite-wing/package-lock.json ./granite-wing/
COPY --from=granite-build --chown=node:node /build/granite-wing/node_modules ./granite-wing/node_modules
COPY --from=granite-build --chown=node:node /build/granite-wing/dist ./granite-wing/dist
COPY --chown=node:node migrations ./granite-wing/migrations
COPY --from=river-build --chown=node:node /build/river-slate/package.json /build/river-slate/package-lock.json ./services/river-slate/
COPY --from=river-build --chown=node:node /build/river-slate/node_modules ./services/river-slate/node_modules
COPY --from=river-build --chown=node:node /build/river-slate/dist ./services/river-slate/dist
COPY --from=shard-build --chown=node:node /build/shard-lantern/package.json /build/shard-lantern/package-lock.json ./services/shard-lantern/
COPY --from=shard-build --chown=node:node /build/shard-lantern/node_modules ./services/shard-lantern/node_modules
COPY --from=shard-build --chown=node:node /build/shard-lantern/dist ./services/shard-lantern/dist
COPY --chown=node:node deployment/container-supervisor.mjs deployment/container-healthcheck.mjs deployment/config.rehearsal.yaml ./deployment/
RUN mkdir -p /var/lib/feather-light /var/lib/river-slate/health-card /var/lib/shard-lantern \
  && chown -R node:node /var/lib/feather-light /var/lib/river-slate /var/lib/shard-lantern
USER node
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
  CMD ["node", "/app/deployment/container-healthcheck.mjs"]
CMD ["node", "/app/deployment/container-supervisor.mjs"]
