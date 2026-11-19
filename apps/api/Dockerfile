# Build from the repo root: docker build -f apps/api/Dockerfile .
# No key, no .env and no build ARG for a key. The model key is a service variable set at run time.

FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable

# Manifests and lockfile first, so the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/paw-core/package.json packages/paw-core/package.json
RUN corepack prepare "$(node -p "require('./package.json').packageManager")" --activate \
  && pnpm install --frozen-lockfile --filter @monkeyspaw/api...

COPY tsconfig.base.json ./
COPY packages/paw-core packages/paw-core
COPY apps/api apps/api
RUN pnpm -C apps/api build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Same layout the server expects: dist/server.mjs next to examples-cache.json.
COPY --from=build --chown=node:node /repo/apps/api/dist/server.mjs dist/server.mjs
COPY --from=build --chown=node:node /repo/apps/api/examples-cache.json examples-cache.json
USER node
EXPOSE 8787
CMD ["node", "dist/server.mjs"]
