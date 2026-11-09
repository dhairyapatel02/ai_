# syntax=docker/dockerfile:1
# Web image (Next.js standalone server). Build from the repo root:  docker build -f apps/web/Dockerfile .
# Override NODE_IMAGE to use a registry mirror (e.g. mirror.gcr.io/library/node:22-alpine, OPS-14).
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
# Shared sources are needed by the root postinstall (builds packages/shared).
COPY packages/shared packages/shared
RUN npm ci --workspace=apps/web --workspace=packages/shared --include-workspace-root
COPY apps/web apps/web
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ARG NEXT_PUBLIC_DEV_LOGIN_EMAIL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_DEV_LOGIN_EMAIL=$NEXT_PUBLIC_DEV_LOGIN_EMAIL \
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
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
