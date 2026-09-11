# Build a pruned standalone Next runtime.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG SERVICE_VERSION=dev
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SERVICE_VERSION=${SERVICE_VERSION} NEXT_PUBLIC_BUILD_COMMIT=${BUILD_COMMIT} NEXT_PUBLIC_BUILD_TIME=${BUILD_TIME} NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
# INTERNAL_API_URL remains a runtime env so the proxy targets the local backend.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3001/healthz | grep -q '"status":"ok"' || exit 1
CMD ["node", "server.js"]
