FROM node:18-alpine

WORKDIR /app

# Build identity. CI / `make build` (in Server/) passes these in
# so the running container reports which commit it came from.
ARG SERVICE_VERSION=dev
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV OBD_SERVICE_VERSION=${SERVICE_VERSION}
ENV OBD_BUILD_COMMIT=${BUILD_COMMIT}
ENV OBD_BUILD_TIME=${BUILD_TIME}

COPY package*.json ./

RUN npm install --omit=dev && npm cache clean --force

COPY . .

EXPOSE 3000

# wget is in busybox on alpine; no need to install it. The
# --spider option does a HEAD request and reports 2xx status
# without downloading the body. Container restart policy
# (restart: always in docker-compose.yml) will recreate a
# failing container; this HEALTHCHECK just lets `docker ps`
# show the right state and lets orchestrators remove the
# container from the load-balancer pool.
# Use 127.0.0.1 not localhost. On Alpine, /etc/hosts has
# `::1 localhost` listed first, so `localhost` resolves to
# IPv6; the Node process binds 0.0.0.0:3000 (IPv4 only) and
# the IPv6 connection is refused. 127.0.0.1 skips the resolver.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz | grep -q '"status":"ok"' || exit 1

CMD ["npm", "start"]
