ARG SOURCE_REPOSITORY=https://github.com/gaato/offkai-manager
ARG VCS_REF=development

FROM node:24.18.0-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
ARG SOURCE_REPOSITORY
ARG VCS_REF
ENV SOURCE_REPOSITORY=$SOURCE_REPOSITORY VCS_REF=$VCS_REF
COPY . .
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
# The glibc image loads better-sqlite3 v13's bundled N-API prebuild.
RUN node -e "const db = new (require('better-sqlite3'))(':memory:'); db.close()"

FROM node:24.18.0-slim AS runtime
ARG SOURCE_REPOSITORY
ARG VCS_REF
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="$SOURCE_REPOSITORY" \
      org.opencontainers.image.revision="$VCS_REF"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 OFFKAI_DATABASE_PATH=/data/offkai.sqlite
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --chown=node:node package.json ./
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md /licenses/offkai-manager/
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "scripts/start.mjs"]
