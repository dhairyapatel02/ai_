# syntax=docker/dockerfile:1
# API + worker image. Build from the repo root:  docker build -f apps/api/Dockerfile .
# Override NODE_IMAGE to use a registry mirror (e.g. mirror.gcr.io/library/node:22-alpine, OPS-14).
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Prisma's engines need libssl, which node:22-alpine already ships (libssl3).
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Shared sources are needed by the root postinstall (builds packages/shared).
COPY packages/shared packages/shared
RUN npm ci --workspace=apps/api --workspace=packages/shared --include-workspace-root
COPY apps/api apps/api
RUN npm run db:generate --workspace=apps/api && npm run build --workspace=apps/api

FROM ${NODE_IMAGE} AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Production dependencies only; lifecycle scripts are skipped, so the generated Prisma client,
# the Prisma engines and the built shared package are copied from the build stage instead.
RUN npm ci --omit=dev --ignore-scripts --workspace=apps/api && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/docker-entrypoint.sh ./apps/api/

WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Applies pending migrations (unless RUN_MIGRATIONS=false), then runs CMD.
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
