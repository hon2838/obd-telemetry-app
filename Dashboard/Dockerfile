FROM node:18-alpine

WORKDIR /app

# Build identity. CI / `make build` (in Dashboard/) passes
# these in so the running container reports which commit it
# came from. The dashboard Next.js page can read these via
# next.config.js (if wired up later); for now the build args
# are also visible in the image's `docker inspect` output.
ARG SERVICE_VERSION=dev
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV NEXT_PUBLIC_SERVICE_VERSION=${SERVICE_VERSION}
ENV NEXT_PUBLIC_BUILD_COMMIT=${BUILD_COMMIT}
ENV NEXT_PUBLIC_BUILD_TIME=${BUILD_TIME}

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 3001

# Healthcheck the Next.js server. /healthz is a tiny page
# (Dashboard/pages/healthz.tsx) that's excluded from the
# auth middleware; it returns 200 with a JSON body containing
# "status":"ok" when the Next.js process is alive. Use
# 127.0.0.1 (not localhost) to skip the IPv6/IPv4 DNS resolver
# issue on Alpine.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/healthz | grep -q '"status":"ok"' || exit 1

CMD ["npm", "start"]
