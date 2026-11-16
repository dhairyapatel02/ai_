# syntax=docker/dockerfile:1
# Web image (Next.js standalone server). Build from the repo root:  docker build -f apps/web/Dockerfile .
# Override NODE_IMAGE to use a registry mirror (e.g. mirror.gcr.io/library/node:22-alpine, OPS-14).
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
# The root postinstall (scripts/postinstall.mjs) builds packages/shared from source.
COPY scripts/postinstall.mjs scripts/
COPY packages/shared packages/shared
RUN npm ci --workspace=apps/web --workspace=packages/shared --include-workspace-root
# Better Auth uses Prisma on the shared database (ADR-0003): generate the client from the API's schema.
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
COPY apps/web apps/web
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_OUTPUT_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=apps/web

FROM ${NODE_IMAGE} AS production
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
# Generated Prisma client (Prisma 7: pg driver adapter, no query-engine binary); not always picked up by file tracing.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
