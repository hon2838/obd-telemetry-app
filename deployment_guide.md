# OBD Telemetry deployment guide

Build and validate release artifacts on the development workstation. The production host only loads the finished images and starts them with Docker Compose.

## Services and ports

- Fastify API: container and host port `3000`.
- Next.js dashboard: container port `3001`, host port `3003`.
- Persistent data: Compose volume `server-data`, mounted at `/app/data` in the API container.
- Dashboard-to-API traffic: `http://server:3000` on the private Compose network.

The Android service continues collecting OBD and GPS readings into Room while internet access is unavailable. It uploads pending rows after connectivity returns and keeps them locally when a request fails.

## Configure the release

Copy `.env.example` to `.env` on the workstation and production host. Keep `.env` outside version control and Docker build contexts.

```env
OBD_API_KEY=<at-least-32-random-characters>
OBD_STORAGE_ENGINE=json
OBD_INITIAL_ADMIN_PASSWORD=
OBD_TRUST_PROXY=false
NEXT_PUBLIC_API_URL=https://obd-api.example.com
SERVICE_VERSION=1.2.0
BUILD_COMMIT=<git-short-sha>
BUILD_TIME=<utc-timestamp>
```

`OBD_API_KEY` is required. The Android client and authorized operators use this shared key. If `OBD_INITIAL_ADMIN_PASSWORD` is empty, the server generates a temporary admin password in `/app/data/.initial_admin_secret` with mode `0600`. Change it at the first login; the server then removes that temporary secret file.

Leave `OBD_TRUST_PROXY=false` unless a trusted proxy sanitizes forwarding headers. When required, set it to `true` or a comma-separated Fastify-compatible list of trusted proxy addresses or CIDRs.

## Validate and build locally

From the repository root:

```bash
cd Server
npm ci
npm test -- --runInBand
npm audit --omit=dev

cd ../Dashboard
npm ci
npm run lint
npm run build
npm audit

cd ../AndroidApp
./gradlew :app:assembleDebug --no-daemon

cd ..
make build
```

Use `make build-all` when the server image must include a newly built APK and its integrity metadata. The `adbwire` module stays outside the normal Android build. It is debug-only and requires the explicit `-PincludeAdbwire=true` opt-in.

Record the build identity printed by `make version`. Do not rebuild the images on the production host.

## Transfer and start

Transfer images through the private registry used by the deployment, or save and load them explicitly. This example uses files:

```bash
podman save -o obd-server.tar obd-telemetry-server:${BUILD_COMMIT}
podman save -o obd-dashboard.tar obd-telemetry-dashboard:${BUILD_COMMIT}
```

On the production host:

```bash
docker load -i obd-server.tar
docker load -i obd-dashboard.tar
docker compose up -d --no-build
docker compose ps
```

The production `.env` must set `BUILD_COMMIT` to the tag that was loaded. Both health checks should become healthy. Verify the API identity with:

```bash
curl --fail http://127.0.0.1:3000/healthz
curl --fail http://127.0.0.1:3003/healthz
```

## Reverse proxy or Cloudflare Tunnel

Route the public API hostname to `http://127.0.0.1:3000` and the dashboard hostname to `http://127.0.0.1:3003`.

```yaml
ingress:
  - hostname: obd-api.example.com
    service: http://127.0.0.1:3000
  - hostname: obd.example.com
    service: http://127.0.0.1:3003
  - service: http_status:404
```

Set `NEXT_PUBLIC_API_URL` before the dashboard image is built because Next.js embeds the browser-facing API origin in the production bundle.

## Android pairing and sync

Configure the Android app with the API base URL, pair the head unit to a vehicle, and retain the issued device credential. The canonical telemetry endpoint is `/api/telemetry/batch`; DTC endpoints are `/api/telemetry/dtc` and `/api/telemetry/dtc/clear`.

Validate the following on actual hardware before promoting an APK:

1. OBD and GPS records continue increasing in Room with internet disabled.
2. Pending counts remain present after failed or unauthorized uploads.
3. The backlog uploads after internet access returns.
4. Records are marked synced only after an HTTP 2xx response.
5. Read and clear DTC commands target the paired vehicle.
6. A command received while the adapter is disconnected remains queued until it can be handled.
7. A lost command response or acknowledgment does not lose the command or repeat a completed clear request.

### Durable diagnostic commands

Deploy the API and dashboard before installing the updated Android APK. The API
uses the existing command behavior for older Android clients; the updated APK
opts into command protocol v2. Until a head unit runs the updated APK, its
legacy command delivery still has the lost-response limitation.

In v2, pending commands have stable IDs and remain on the server until the
paired device acknowledges an outcome. The head unit saves each command in its
local database before attempting it and can poll for commands independently of
telemetry uploads. A read can be retried after interruption. If a clear request
was started but its result is uncertain after a crash, the dashboard reports
**Outcome unknown**; inspect the vehicle before requesting another clear.

Before promoting an APK, test offline delivery, an unavailable OBD adapter,
app restart, a lost upload response, and a lost acknowledgment response on a
test vehicle. Back up the server volume before the API upgrade because command
queue entries are migrated to stable IDs. The API refuses to start if the
command queue file is malformed, preserving it for repair or restore.

## Operations and backup

View service logs with `docker compose logs -f server dashboard`. Back up the named volume before upgrades or account-store migrations. A portable backup command is:

```bash
docker run --rm \
  -v obd-telemetry-app_server-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine tar -czf "/backup/obd-data-$(date +%F-%H%M%S).tar.gz" -C /data .
```

Keep the backup and the release images until the new containers have passed health, authentication, pairing, ingestion, dashboard, and offline catch-up checks.

### Optional SQLite telemetry rollout

SQLite removes the full `telemetry.json` rewrite from each ingest. It remains
opt-in for existing installations. Stop the API and take the volume backup
above before changing `OBD_STORAGE_ENGINE` from `json` to `sqlite`. On its
first SQLite startup, the server imports `telemetry.json` into
`telemetry.sqlite` as one transaction and marks the import complete. It refuses
to start if an existing database is incompatible or its import state is
ambiguous; investigate the data directory rather than deleting either store.

After startup, compare the `telemetry_records` value from `/healthz` with the
pre-migration count and check history, a recent snapshot, and an Android
offline catch-up. The JSON file is retained as a rollback source, but becomes
stale once SQLite accepts new telemetry. To return to JSON after that point,
stop the API and export the SQLite database with
`node Server/scripts/export_sqlite_to_json.js <path-to-telemetry.sqlite> <path-to-telemetry.json>`
before setting `OBD_STORAGE_ENGINE=json`. Keep the volume backup until this
validation is complete.
