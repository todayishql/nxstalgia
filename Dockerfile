# syntax=docker/dockerfile:1

# ---------- deps: cài dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder: build Next.js (output standalone) ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runner: image chạy production ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# chạy dưới user không phải root (node:alpine có sẵn user 'node')
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# mã nguồn thô cho các script one-off (import-seed / create-admin),
# chạy bằng: docker compose exec app node scripts/xxx.mjs
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/models ./models
COPY --from=builder --chown=node:node /app/lib ./lib

USER node
EXPOSE 3000
CMD ["node", "server.js"]