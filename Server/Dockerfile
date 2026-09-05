FROM node:24-alpine

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

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

EXPOSE 3000

# The installer script is copied into the image as part of
# the build context (Server/install.sh), placed there by
# `make apk-bundle` from the repo root's static/install.sh.
# We chmod it here so the entry point can execute it
# directly via `curl ... | sh` patterns where the head unit
# pulls the file fresh from the server.
RUN if [ -f /app/install.sh ]; then chmod +x /app/install.sh; fi

# Where the Android APK and its version sidecar live inside
# the image. The build pipeline (see Makefile `make apk`)
# copies the freshly-built app-debug.apk from
# AndroidApp/app/build/outputs/apk/debug/ into
# Server/agent/ before `docker build` is run. The server then
# exposes the file at /api/agent/latest.apk so the head unit's
# installer script can curl it down.
#
# If the agent/ dir is empty (developer build that didn't run
# the apk-bundle target), the /api/agent/* routes return 404
# with a clear error message rather than crashing the server.
ENV APK_PATH=/app/agent/app-debug.apk
ENV APK_VERSION_PATH=/app/agent/version.json

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
