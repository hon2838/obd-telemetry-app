# OBD stack review and improvement proposal

Reviewed 5 September 2026. Scope: the local working tree, including uncommitted Android service/chart changes and the new `adbwire` module. No application code or deployment was changed. Live server performance and head-unit behavior were not measured.

The existing architecture—Kotlin/Room on the head unit, Fastify API, Next.js dashboard, and two containers—is a reasonable base for a personal vehicle or small fleet. The highest-value work is closing authorization gaps, making synchronization durable and repeatable, and removing processing that grows with the entire telemetry history.

## Evidence and verification

- All 8 backend Jest suites passed: 51 tests. Tests ran against a temporary copy because several tests hard-code `Server/data` paths or mutate account/store state.
- Dashboard TypeScript check passed with `tsc --noEmit --incremental false`. Its configuration currently disables strict mode.
- Separate local Fastify probes confirmed unauthenticated fuel creation, retrieval, and deletion returned 201, 200, and 200.
- Sending timestamps 2000, 1000, and 1000 stored three records; `/api/telemetry/latest` returned 1000. Retries are not deduplicated and latest means last received rather than newest captured.
- More than 200 requests to the latest endpoint were accepted without a 429 despite the configured 200-per-15-minute limit. The rate-limit plugin installs an `onRoute` hook, while routes are declared before plugin boot completes; registration order is a likely cause to confirm with a regression test.
- No Android build, hardware test, browser end-to-end run, or production load test was performed.

## First: security and data integrity

| Priority | Finding | Proposed change |
|---|---|---|
| P0 | Fuel and maintenance mutations, DTC ingestion, device revocation, and sensitive reads lack consistent authentication. | Apply a default-deny API authentication hook, with explicit public exceptions for health and the necessary pairing bootstrap routes. Enforce owner/vehicle access on every read and mutation. |
| P0 | Device authentication returns a vehicle scope, but telemetry ingestion trusts the payload's vehicle ID. Commands accept any authenticated identity without role/ownership checks. | Derive allowed vehicle scope from the credential. Reject mismatches; distinguish user/admin actions from device ingestion and command-result delivery. Test cross-vehicle denial. |
| P0 | A predictable bootstrap admin password is created automatically. Sessions have no expiry check, and password changes do not invalidate older sessions. | Use a one-time setup secret, enforce password replacement server-side, add session expiry/logout/revocation, and invalidate sessions on password changes. Hash device tokens at rest and protect Android credentials with Keystore-backed encryption and backup exclusions. |
| P0 | The uncommitted `adbwire` module opens ADB-like and raw shell listeners without authentication. | Keep this out of production releases until access is authenticated and explicitly enabled for a short session. Shell execution has the app's effective privileges; it should not be described as inherently root access. |
| P1 | Telemetry returns 201 before persistence completes; persistence errors are swallowed. Android deletes its local copy after success. | Acknowledge only after durable database commit. On failure, return a retryable error and retain the local outbox. |
| P1 | Uploads are append-only and have no stable record identity. Fuel retries receive newly generated server IDs. | Generate a persistent UUID per event, or a stable device/session/sequence identity. Enforce uniqueness in storage; return accepted/duplicate/rejected IDs and delete only acknowledged local rows. |
| P1 | Commands are removed when attached to an upload response, before device receipt or execution. A disconnected adapter causes the handler to return. | Persist command IDs and queued/delivered/acknowledged/completed/failed states, expiry, and results. Add a heartbeat/command fetch independent of telemetry backlog. Prevent blind replay of a command whose execution outcome is unknown. |

Evidence: [server auth and ingest](</home/hon2838/Documents/Code/OBD App/Server/server.js:315>), [persistence](</home/hon2838/Documents/Code/OBD App/Server/server.js:184>), [fuel API](</home/hon2838/Documents/Code/OBD App/Server/server.js:1330>), [device revocation](</home/hon2838/Documents/Code/OBD App/Server/server.js:2108>), [Android acknowledgment path](</home/hon2838/Documents/Code/OBD App/AndroidApp/app/src/main/java/com/example/obdapp/OBDGatewayService.kt:276>), [remote shell](</home/hon2838/Documents/Code/OBD App/AndroidApp/adbwire/src/main/java/com/example/adbwire/AdbServer.kt:218>).

## Optimize the backend and storage

**Move JSON telemetry to indexed transactional storage.** Every ingest currently serializes the complete telemetry array, and all history stays in RAM. Vehicle counts, filtered latest readings, trips, and leaderboards repeatedly scan or sort it. For the present single-server design, SQLite is a sensible starting point: index `(vehicle_id, captured_at)` and make event IDs unique. Use a maintained SQLite release, appropriate durability settings, and WAL/checkpoint monitoring. PostgreSQL becomes worth considering if concurrent writers or multiple API instances become a real requirement. [SQLite WAL documentation](https://www.sqlite.org/wal.html).

**Materialize trip summaries.** Persist stable trip IDs and incrementally update distance, duration, extrema, and events. Recompute the affected time window when late records arrive. Paginate trip lists and keep route points in separate detail queries; avoid returning every trip's full points during overview refreshes.

**Bound history requests.** Add cursor pagination, maximum time ranges, and a maximum number of chart points. Preserve peaks with min/max buckets or an appropriate downsampling algorithm. Offer raw CSV/GPX separately. Introduce configurable raw-data retention and longer-lived summaries, with archive/restore before any purge.

**Reduce authentication overhead.** Dashboard middleware currently calls `/api/auth/login` for each Basic-authenticated request, creating a new unused session. Password verification uses synchronous scrypt on the Node event loop. Log in once using an HttpOnly, Secure session cookie, validate the session cheaply, use asynchronous password hashing, and protect cookie-authenticated mutations against CSRF.

**Make throttling match usage.** Verify enforcement first, then use separate budgets for login/pairing, devices, dashboard reads, and commands. Three-second polling is 300 requests per 15 minutes for one endpoint, exceeding the present default if enforced. Behind the dashboard proxy/tunnel, configure trusted forwarding carefully or prefer authenticated identity keys.

Evidence: [dashboard middleware](</home/hon2838/Documents/Code/OBD App/Dashboard/middleware.ts:22>), [history/latest routes](</home/hon2838/Documents/Code/OBD App/Server/server.js:1291>), [trip endpoints](</home/hon2838/Documents/Code/OBD App/Server/server.js:1242>).

## Optimize the Android collector

- **Make service startup idempotent.** Each `onStartCommand` launches another polling and synchronization set. Hold explicit job references or a single service state machine so repeated start requests cannot create duplicate collectors.
- **Schedule PIDs by need.** The current cycle reads eight PIDs serially, adds eight 100 ms delays, then sleeps three seconds. Measure adapter round-trip time; sample speed/RPM more often than fuel level/ambient temperature. Discover supported PIDs and isolate an unsupported PID from transport failures, so one failure does not reset the entire connection.
- **Use one synchronization implementation.** The foreground service and `TelemetrySyncWorker` duplicate serialization; the worker has no scheduling reference in the inspected source and omits some fields/command handling. Share an outbox repository and HTTP client, with explicit connect/read/overall deadlines, cancellation, jittered retries, and connectivity-triggered catch-up.
- **Drain backlogs efficiently.** Fetches are capped at 500 rows and the loop sleeps after each cycle. Upload several bounded batches during recovery, subject to network/data budgets. Treat authentication errors, invalid records, rate limits, and transient server failures differently so one invalid batch cannot block all later telemetry.
- **Preserve queued data during upgrades.** Room provides migrations 4→5 and 6→7, with destructive fallback and no 5→6 path. Export schemas, add supported migration paths and migration tests, and remove destructive fallback for user data. Android documents that fallback can permanently delete stored data. [Room migration guidance](https://developer.android.com/training/data-storage/room/migrating-db-versions).
- **Track quality and power explicitly.** Store GPS fix age/accuracy, sensor availability, capture/receive times, and adapter state. Suspend unnecessary GPS work when parked; retain ACC behavior compatible with the FYT unit. Use hysteresis/cooldowns for alerts—the current code can create a new notification on every bad reading.
- **Make performance measurements honest.** Current acceleration timing starts at the first positive speed and samples several seconds apart. Use a monotonic clock, require a confirmed standing start, increase speed sampling only when needed, interpolate threshold crossings, and show confidence. Two decimal places currently imply unsupported precision.

Evidence: [service start](</home/hon2838/Documents/Code/OBD App/AndroidApp/app/src/main/java/com/example/obdapp/OBDGatewayService.kt:171>), [PID loop](</home/hon2838/Documents/Code/OBD App/AndroidApp/app/src/main/java/com/example/obdapp/OBDGatewayService.kt:607>), [Room configuration](</home/hon2838/Documents/Code/OBD App/AndroidApp/app/src/main/java/com/example/obdapp/AppDatabase.kt:19>), [outbox query](</home/hon2838/Documents/Code/OBD App/AndroidApp/app/src/main/java/com/example/obdapp/TelemetryDatabase.kt:44>).

## Improve the dashboard and features

The existing latest-record optimization reduces payload size, but misses intermediate samples arriving in each 60-second upload. Add a cursor-based delta endpoint that returns all newly committed records. Server-Sent Events can notify connected browsers about batches; it cannot make the head unit's 60-second uploads arrive sooner. If faster live viewing is useful, add a temporary live upload mode while someone is watching, with a defined data budget.

Use a shared query/cache layer, cancel obsolete requests when switching vehicles, pause background-tab polling, and combine related summaries. Move maps into one reusable, lazy-loaded component with a pinned package dependency. Configure one internal API destination with deadlines; blindly retrying mutations against fallback destinations can duplicate a write after a response failure.

| Feature | Useful first version |
|---|---|
| Vehicle connection health | Separate Bluetooth, GPS, server, and sync status; show queued records, oldest pending age, last successful upload, reconnect count, and app version. |
| Reliable trip journal | Stable trips, playback with synchronized charts, trip names/notes, merge/split corrections, idle time, and quality flags for incomplete routes. |
| Better fuel accounting | Price/litre, total cost in RM, full versus partial fills, missed-fill handling, cost/km, monthly totals, and odometer validation. Clearly label tank-level-derived estimates. |
| Maintenance history | Store individual service events, cost, odometer, notes and receipts; support both time and distance reminders and an editable odometer baseline. Current “mark serviced” updates the schedule instead of preserving a service-event ledger. |
| Diagnostic timeline | First/last occurrence, recurrence count, readings around the event, command delivery status, and a saved snapshot before clearing. Add freeze-frame/readiness data only where the ECU/adapter supports it. |
| Configurable alerts | Per-vehicle thresholds with persistence/hysteresis, alert history and acknowledgment; optional push notifications after local alert behavior is reliable. |
| Offline mobile access | Retain a bounded local history and cached summaries so trips, fuel and maintenance remain useful without the server; synchronize edits using record versions and conflict rules. |

Evidence: [live chart polling](</home/hon2838/Documents/Code/OBD App/Dashboard/components/TelemetryChart.tsx:184>), [API proxy](</home/hon2838/Documents/Code/OBD App/Dashboard/pages/api/[...path].ts:48>), [service completion](</home/hon2838/Documents/Code/OBD App/Server/server.js:1623>).

## Deployment, dependencies and testing

- Upgrade both Node 18 container images and Node 20 CI to a supported LTS baseline, such as Node 24. Node 18 and 20 are EOL. Upgrade Fastify 4, whose LTS ended June 2025, together with compatible plugins. [Node support](https://nodejs.org/en/about/previous-releases), [Fastify LTS](https://github.com/fastify/fastify/blob/main/docs/Reference/LTS.md).
- Upgrade Next.js 13.4.12 to a currently supported patched release. It predates the middleware authorization-bypass fix; this self-hosted `next start` design is relevant to that advisory. API authorization must remain independent of middleware. [Official postmortem](https://vercel.com/blog/postmortem-on-next-js-middleware-bypass).
- Add `.dockerignore` files: both Dockerfiles use `COPY . .` without them, so local dependencies, build output, or runtime data can enter build contexts/images. Use `npm ci`, multiple build stages, a minimal non-root runtime, and Next standalone output.
- Generate signed release APKs in a release job, publish immutable artifacts and checksums, and retain rollback versions. CI currently requires staged APK files that `.gitignore` excludes, without building them first. Add an actual Android build and focused migration/lifecycle tests.
- Add isolated API authorization, replay, failed-persistence, command-acknowledgment, and out-of-order tests. Run browser interaction tests in CI with disposable credentials, covering pairing and vehicle switching rather than only page headings. Test data paths should never default to development stores.
- Report storage-write health, disk space, ingest latency, event-loop delay, sync lag and command age. `/healthz` currently reports “ok” without proving storage readiness. Monitor unhealthy containers explicitly; `restart: always` alone does not restart a still-running unhealthy process.
- Automate backups with a tested restore procedure, log rotation and rollback validation. Align deployment documentation with the existing local-build policy; the guide currently instructs building on the remote server.

## Recommended implementation order

1. **Secure access:** API authorization and vehicle isolation, account/session fixes, dependency baseline, and exclusion of unauthenticated remote shell access.
2. **Make delivery reliable:** database migration, event identities, durable acknowledgments, command tracking, Android job lifecycle and migration safety.
3. **Make it efficient:** incremental trip summaries, bounded/delta queries, shared dashboard caching, adaptive PID schedules and backlog draining.
4. **Add user value:** connection-health view first, then accurate fuel costs, maintenance history, trip playback and diagnostic timelines.

Acceptance targets should be measured on representative data: zero extra rows after replaying a batch; zero acknowledged records lost in restart/failure tests; no cross-vehicle access; one collector after repeated starts; and history/query latency bounded as retained data grows. Establish actual latency, storage, bandwidth and head-unit CPU baselines before setting numerical performance targets.
