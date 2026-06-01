FROM node:18-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

RUN npm install --workspace=apps/api --workspace=packages/shared

# Build shared package
COPY packages/shared ./packages/shared
RUN npm run build --workspace=packages/shared

# Build API
COPY apps/api ./apps/api
RUN cd apps/api && npx prisma generate
RUN npm run build --workspace=apps/api

# Production
FROM node:18-alpine AS production
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/api/dist ./dist
COPY --from=base /app/apps/api/prisma ./prisma
COPY --from=base /app/apps/api/node_modules/.prisma ./node_modules/.prisma

EXPOSE 4000
CMD ["node", "dist/main.js"]
