FROM node:18-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN npm install --workspace=apps/web --workspace=packages/shared

# Build shared package
COPY packages/shared ./packages/shared
RUN npm run build --workspace=packages/shared

# Build web app
COPY apps/web ./apps/web
RUN npm run build --workspace=apps/web

# Production
FROM node:18-alpine AS production
WORKDIR /app

COPY --from=base /app/apps/web/.next ./.next
COPY --from=base /app/apps/web/public ./public
COPY --from=base /app/apps/web/package.json ./
COPY --from=base /app/node_modules ./node_modules

EXPOSE 3000
CMD ["npm", "start"]
