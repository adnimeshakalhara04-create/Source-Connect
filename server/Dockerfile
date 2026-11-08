# syntax=docker/dockerfile:1
# Source Connect API — production image (Node.js 22 LTS, non-root, no dev dependencies)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# optional build secret `proxy_ca` = extra CA certificate when building behind a TLS-inspecting proxy (not needed on a normal VPS)
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca NPM_CONFIG_CAFILE=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r app && useradd -r -g app -d /app app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./dist/migrations
# the seed reads the curated catalogue from the website's js/store.js (copied in by the build context: see infra/deploy/deploy.sh)
COPY seed-catalogue/store.js /js/store.js
USER app
EXPOSE 8080
# run with `init: true` (compose) / `docker run --init` so signals and zombie processes are handled
CMD ["node", "dist/src/server.js"]
