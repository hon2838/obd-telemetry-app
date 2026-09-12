# OBD Telemetry Platform Optimization Review

Reviewed: 12 September 2026  
Repository: `/home/hon2838/Storage/Documents/Code/OBD App`  
Revision: `bf2ce3d9df458452ae001c6f0feec2a59856e79d` (`main`, equal to `origin/main`)  
Method: independent source review, current automated checks, production dashboard build inspection, and isolated synthetic server benchmarks. No production deployment or physical head-unit test was performed.

## Executive assessment

The latest optimization commit is directionally good. It added incremental event-ID deduplication, cached trip summaries, a cursor feed without per-request sorting, adaptive dashboard polling, and chart decimation. These changes reduce repeated work and preserve the intended sync model: the Android app continues collecting OBD data while the API is unavailable, stores it locally, and drains the outbox when connectivity returns.

The largest remaining bottleneck is the server's JSON storage model. Every accepted telemetry batch builds and serializes the complete history, writes it to a staging file, fsyncs it, and renames it while all mutations share one queue. Cost therefore rises with retained history even when only one record is added. The second major issue is the dashboard bootstrap: it loads recent history but also starts the change cursor at zero, so every browser refresh eventually downloads the entire telemetry history and discards all but 2,000 records.

For a personal vehicle with short retention, the current stack is usable. It is not performance-stable as history grows. At the current nominal three-second capture interval, 75,000 samples represent about 31 days at two driving hours per day, or 2.6 days of continuous operation. A 1 CPU / 1 GB deployment will eventually experience long event-loop pauses, large memory peaks, slow backlog recovery, and oversized browser transfers unless storage and query behavior are changed.

## Fresh evidence

All checks ran against the current clean checkout:

| Check | Result |
|---|---:|
| Backend Jest | 12 suites, 101 tests passed |
| Dashboard TypeScript and production build | Passed |
| Android debug unit tests | Passed; tasks were already up to date |
| Production dashboard's largest shared chart chunk | 392.9 KB raw / 103.0 KB gzip |

Synthetic server benchmark results used representative telemetry fields and an isolated temporary data directory:

| Retained rows | Telemetry file after one ingest | Process RSS after benchmark | One-record ingest | Fresh cursor replay |
|---:|---:|---:|---:|---:|
| 5,000 | 2.11 MiB | 118.8 MiB | 10.1 ms | 1.64 MB / 10 requests |
| 25,000 | 10.57 MiB | 203.2 MiB | 32.9 ms | 8.24 MB / 50 requests |
| 75,000 | 31.77 MiB | 298.0 MiB | 115.9 ms | 24.77 MB / 150 requests |

At 75,000 rows, the first trip-summary request took 31.0 ms and a cached repeat took 0.27 ms, showing that the new trip cache works. A performance-records request still took 16.9 ms because it filters and sorts telemetry again. These are local in-process measurements and should be treated as comparative evidence rather than production latency estimates.

## Prioritized opportunity matrix

| ID | Priority | Area | Opportunity | Primary gain |
|---|---|---|---|---|
| OPT-001 | P0 | Server storage | Replace full-file JSON telemetry persistence with indexed transactional storage | Stable ingest latency, lower RAM and disk I/O |
| OPT-002 | P0 | Dashboard/API | Bootstrap live charts from a snapshot cursor instead of cursor zero | Eliminate full-history replay on every page load |
| OPT-003 | P0 | API/proxy | Enforce response/query bounds and stream large responses | Bound memory, bandwidth, and response time |
| OPT-004 | P1 | Analytics | Materialize stable trip and performance summaries | Remove repeated scans, sorts, and drive matching |
| OPT-005 | P1 | Change feed | Seek by ingest sequence rather than scanning from array index zero | History-size-independent polling |
| OPT-006 | P1 | Dashboard | Consolidate related reads and add error backoff/conditional refresh | Fewer requests and less repeated JSON work |
| OPT-007 | P1 | Android collector | Sample platform state by cadence/change and suppress alert storms | Lower CPU, process creation, and power use |
| OPT-008 | P1 | Android outbox | Align Room indexes with actual page queries and remove count probes | Faster large-backlog drain |
| OPT-009 | P2 | Server caches/indexes | Normalize and bound caches; maintain per-vehicle counts/latest indexes | Lower cache duplication and list-scan cost |
| OPT-010 | P2 | OBD polling | Adapt PID cadence to vehicle state and adapter capability | Better freshness per adapter request and lower load |
| OPT-011 | P2 | Frontend rendering | Downsample before transfer and lazy-load heavy visual modules | Faster initial load and less client work |
| OPT-012 | P1 | Operations | Add performance telemetry and regression budgets | Detect scaling regressions before deployment |

## Detailed findings and recommendations

### OPT-001 — Full-history persistence dominates ingest

**Evidence.** `Server/server.js:467` serializes the supplied store with pretty-printed JSON. Telemetry ingestion creates `telemetryDataStore.concat(accepted)` at `Server/server.js:1714`, then calls the synchronous journal transaction at `Server/server.js:1723-1725`. The operation rewrites the entire telemetry file and blocks the Node event loop. All mutations are serialized through the global queue at `Server/server.js:496-519`.

**Impact.** The measured one-record ingest rose from 10.1 ms at 5,000 rows to 115.9 ms at 75,000 rows. During the write, reads share the same event loop and can pause. The process also retains the whole parsed history plus serialization/candidate copies, reaching about 298 MiB RSS in the 75,000-row benchmark. There is no telemetry retention or archive policy.

**Remediation.** Move telemetry, command state, fuel logs, maintenance, devices, and users into SQLite with WAL mode for the current single-host design. Use one transaction for telemetry acceptance and command delivery state. Create at least these indexes:

- unique `(vehicle_id, event_id)` for idempotent ingestion;
- unique `ingest_seq` and `(vehicle_id, ingest_seq)` for change feeds;
- `(vehicle_id, captured_at)` for history and drive windows;
- indexes for pending command status and expiry.

Import existing JSON through a one-time, resumable migration: validate files, create a backup, import into a temporary database, compare row counts and representative aggregates, fsync, then atomically activate it. Keep rollback support until the new database passes restart and replay tests. Add configurable raw-data retention with daily/monthly summaries before purging anything.

Compact JSON or append-only NDJSON could reduce short-term write amplification, but it would retain custom crash recovery, compaction, indexing, and multi-file consistency complexity. It is useful only as a temporary bridge.

### OPT-002 — Dashboard bootstrap replays all historical telemetry

**Evidence.** `Dashboard/components/TelemetryChart.tsx:280-288` fetches recent history and `/api/telemetry/changes?cursor=0` concurrently. Later polls continue from that cursor, while `mergeRecords` retains only the last 2,000 points at `Dashboard/components/TelemetryChart.tsx:229-241`.

**Impact.** A fresh session against 75,000 rows transferred 24.77 MB across 150 change requests at the component's 500-row page size, in addition to the recent-history request. The component allows four pages per poll, so a live vehicle needs roughly 38 polling cycles to traverse 75,000 rows. The browser ultimately discards about 97% of those records.

**Remediation.** Make the initial history response return a consistent `snapshotCursor` with the bounded tail, for example:

```json
{
  "records": [],
  "snapshotCursor": 75000
}
```

The dashboard should merge that tail and request changes strictly after `snapshotCursor`. The server must choose the records and cursor from one database snapshot so a record cannot fall between the two. A compatibility path can retain the current array response for old clients or introduce `/api/telemetry/snapshot` as a new endpoint.

### OPT-003 — Query and response memory are not bounded end to end

**Evidence.** `/api/telemetry/history` accepts any positive `limit` without a maximum at `Server/server.js:2216-2222`. When `start` and `end` are present, it returns every matching row before applying any cap at `Server/server.js:2203-2208`. The trip detail page requests that range, transforms every row, and only then reduces it to 750 chart points at `Dashboard/pages/trips.tsx:74-86`. The Next.js proxy reads every upstream response into one `ArrayBuffer` at `Dashboard/pages/api/[...path].ts:58-67`.

**Impact.** A large history or export can exist simultaneously as server objects, serialized response bytes, proxy bytes, browser JSON, transformed chart objects, and rendered chart data. This adds memory pressure to both containers and the browser. Request bodies now have useful limits, but slow request-body reads are not cancelled by the proxy's upstream timeout.

**Remediation.** Clamp history to a maximum page size and maximum time window, including `start/end` requests. Add cursor pagination. Provide a server-side downsampled trip-series endpoint that preserves first/last points and min/max peaks per bucket. Stream CSV, GPX, APK, and other large upstream bodies through the proxy with backpressure instead of `arrayBuffer()`. Add an explicit maximum for non-streamed upstream responses and a total request deadline that also stops slow body reads.

### OPT-004 — Analytics still rescans and resorts raw telemetry

**Evidence.** `segmentDrives` groups, copies, sorts, retains point arrays, and calculates summaries at `Server/server.js:1272-1405`. The cache makes repeat requests cheap, but any new record invalidates affected scopes. `/api/performance/records` independently filters and sorts speed, RPM, and acceleration data at `Server/server.js:1991-2041`; its `findDrive` performs a linear drive search for selected records. Leaderboards copy and sort the complete drive list four times at `Server/server.js:2169-2186`.

Export authorization also calls `segmentDrives()` through `stores.getDrive` at `Server/server.js:1590`, then the route calls it again through `getDriveBounds` at `Server/server.js:2064-2067`.

**Remediation.** Persist stable trips and incrementally maintained summaries. Associate telemetry/performance events with a stable trip ID. Update only the open trip during ordinary in-order ingestion; when late data arrives, recompute the affected vehicle/time window. Maintain top values in a per-vehicle aggregate table. Paginate trip lists and calculate top-five leaderboards in one pass or database query. Resolve an export's authorized drive once and reuse it in the handler.

### OPT-005 — Change-feed pages scan from the beginning

**Evidence.** `/api/telemetry/changes` initializes `index = 0` for every request and loops through the complete array until `ingestSeq > cursor` at `Server/server.js:2252-2258`. It also calls `filterRecordsByScope([record], ...)`, allocating temporary arrays while scanning.

**Impact.** Polling cost grows with total retained history even when no new data exists. Catch-up uses many pages, so old prefixes are scanned repeatedly.

**Remediation.** The SQLite `(vehicle_id, ingest_seq)` index solves this directly. Before that migration, use a binary search over the monotonically increasing `ingestSeq` array to find the first candidate and check vehicle access without one-element array allocations. Add a benchmark that asserts near-tail/no-change latency does not grow linearly from 10,000 to 1,000,000 rows.

### OPT-006 — Several pages poll duplicate or unchanged data

**Evidence.** Trips requests `/api/drives` and `/api/trips/leaderboard` every 10 seconds (`Dashboard/pages/trips.tsx:92-106`). Performance requests two endpoints every 10 seconds (`Dashboard/pages/performance.tsx:49-64`). Fuel and maintenance likewise request paired endpoints every 10 seconds. Diagnostics polls complete status/history every three seconds and repeats code lookup work (`Dashboard/pages/diagnostics.tsx:67-79`). `useVisibilityPolling` prevents overlap and hidden-tab work, but retries failures at the normal interval and has no jitter (`Dashboard/hooks/useVisibilityPolling.ts:22-34`).

**Remediation.** Return each page's related data from one versioned summary endpoint or shared query layer. Add an `ETag`/revision and return `304` when unchanged. Poll diagnostics quickly only while a command is pending, then fall back to 30-60 seconds. Apply exponential error backoff, bounded jitter, and `Retry-After`. Poll trips, fuel, maintenance, and performance on focus, after a mutation, and at a slower freshness interval because the Android uploader normally syncs once per minute.

### OPT-007 — Android performs slow platform probes at telemetry cadence

**Evidence.** Every collection cycle reads ACC, headlights, volume, Wi-Fi SSID, and Bluetooth state at `AndroidApp/app/src/main/java/com/example/obdapp/OBDGatewayService.kt:578-606`. The helpers repeatedly reflect `android.os.SystemProperties`; the Wi-Fi fallback can launch a `getprop` process at `OBDGatewayService.kt:787-813`. Alerts use a new notification ID on every bad sample at `OBDGatewayService.kt:354-363` and are called every cycle while a threshold remains violated.

**Impact.** These values do not need three-second sampling. Repeated reflection, service lookups, possible child-process creation, broadcasts, and notification creation waste CPU and power on the head unit. Persistent bad readings can create a notification storm.

**Remediation.** Cache the reflected class/method once. Sample low-change platform fields every 30-60 seconds or update them from system callbacks where reliable. Never launch `getprop` in the hot telemetry loop; cache the result with a long expiry. Add alert hysteresis and a cooldown, using one stable notification ID per alert type. Record state transitions rather than repeating identical values if the server schema is normalized later.

### OPT-008 — Room indexes do not match backlog page ordering

**Evidence.** Telemetry pages filter by `vehicleId` and `synced` but order by `timestamp` (`TelemetryDatabase.kt:57-58`). The declared index is only `(vehicleId, synced)` (`TelemetryDatabase.kt:13-19`). Fuel has the same pattern. Maintenance orders by `id`; its index also omits `id`. After each successful pass, the uploader runs up to three `COUNT(*)` queries to determine whether more remains (`OutboxUploader.kt:268-277`). Connectivity availability launches an immediate drain and also wakes the service drain, producing a second serialized no-op attempt (`OutboxUploader.kt:69-74`).

**Remediation.** Add composite indexes matching each query:

- telemetry `(vehicleId, synced, timestamp)`;
- fuel `(vehicleId, synced, timestamp)`;
- maintenance `(vehicleId, synced, id)`.

Return or infer `hasMore` from page size and acknowledgements instead of three count queries per pass. Route connectivity through one conflated wake-up path. Preserve the current mutex and event-ID acknowledgement semantics. Add a large offline-queue instrumentation benchmark because the present unit suite does not measure Room query plans or real network recovery.

### OPT-009 — In-memory indexes and caches can be more compact

**Evidence.** `/api/vehicles` scans the complete telemetry, fuel, and maintenance arrays separately for every vehicle at `Server/server.js:2542-2552`. Analytics cache keys include the user ID even when two users have the same permitted vehicle scope (`Server/server.js:1407-1419`), duplicating identical results. Cache maps have no explicit entry bound.

**Remediation.** Maintain per-vehicle counts and latest pointers during mutation commits. Key read caches by normalized authorized vehicle set and data revision, not user identity. Add an LRU/size bound. These improvements become simple indexed queries after the SQLite migration, so avoid building a large custom index layer that will soon be discarded.

### OPT-010 — OBD sampling can react to state and capability

**Evidence.** The service correctly keeps local collection independent of API connectivity. While ACC is on, it sends four fast PID requests each cycle plus at most one slower PID and fixed inter-command delays (`OBDGatewayService.kt:515-549`), then waits three seconds. Slow PIDs already use sensible staggered cadences.

**Remediation.** Keep offline collection, but discover supported PIDs once per adapter/vehicle and stop repeatedly requesting unsupported values. Use faster speed/RPM sampling only during motion or an active acceleration run, normal cadence while driving steadily, and a slower heartbeat when stationary. Measure actual ELM327 round-trip time before tuning the 100 ms gaps. Store sampling profile and adapter error counters so improvements can be verified on the real head unit.

### OPT-011 — Client work is reduced late in the pipeline

**Evidence.** Trip detail receives and transforms the full range before selecting 750 points. Recharts contributes about 103 KB gzip to chart routes in the current production build. Leaflet is injected from a CDN when the main telemetry component mounts, even if the user is focused on non-map telemetry.

**Remediation.** Downsample on the server so unused points never cross the proxy or reach React. Dynamically import chart/map components below the fold or when their tab becomes visible. Keep the current 750-point rendering bound; use min/max or LTTB-style downsampling rather than simple even spacing when preserving brief RPM/speed peaks matters.

### OPT-012 — There are no performance budgets or runtime metrics

**Evidence.** The test suite validates behavior but does not fail on history-size-dependent latency, memory growth, event-loop delay, backlog drain speed, payload size, or browser request count. `/healthz` does not expose these performance signals.

**Remediation.** Add low-cardinality metrics for ingest duration, persistence duration, event-loop delay, process RSS/heap, store/database size, history/change latency, response bytes, Android pending row count and oldest age, last successful sync, batch acknowledgements, retries, and adapter round-trip time. Do not label high-cardinality vehicle IDs in globally exported metrics; expose per-vehicle detail only through authenticated diagnostics.

## Recommended implementation sequence

### P0 immediate — bounded network work

1. Add a snapshot/tail endpoint that returns recent records and its exact ingest cursor.
2. Start dashboard changes after that cursor; add a regression test proving a 75,000-row refresh transfers only the configured tail plus new rows.
3. Clamp every history query and require cursor pagination for larger ranges.
4. Stream large proxy responses and exports with backpressure; cover client disconnect and total-deadline behavior.
5. Add automated scaling checks before changing storage so improvements have a reliable baseline.

### P1 structural — stable storage and analytics

1. Introduce SQLite WAL and the indexes described above behind a storage interface.
2. Build and test a resumable JSON-to-SQLite migration with backup, parity validation, restart recovery, and rollback.
3. Move change, latest, history, count, and idempotent ingest operations to indexed queries.
4. Materialize stable trips, performance records, and page summary revisions.
5. Consolidate dashboard calls, conditional refreshes, and error backoff.
6. Add the Android composite indexes, one connectivity wake path, and efficient page completion logic.

### P2 device and client efficiency

1. Cache/refactor hot-loop platform probes and add alert cooldown/hysteresis.
2. Implement capability-aware and state-aware PID schedules without weakening offline collection.
3. Serve downsampled trip series and lazy-load visualization code.
4. Define and enforce raw telemetry retention, summary retention, backup, and archive policies.

## Acceptance targets

| Boundary | Target |
|---|---|
| Ingest scaling | P95 for a 100-row batch stays within 2x from 100,000 to 1,000,000 retained rows |
| Event loop | No persistence-induced delay above 50 ms in representative 1 CPU tests |
| Dashboard bootstrap | At most one bounded tail response plus one change request; no replay from cursor zero |
| Live no-change poll | Indexed lookup; latency does not grow linearly with retained history |
| History | Server-enforced row/time caps; peak memory remains bounded during client and upstream disconnects |
| Trips/performance | Stable trip IDs; ordinary in-order ingest updates only the open trip and aggregates |
| Offline Android sync | 24-hour synthetic queue drains without loss, duplication, starvation, or unbounded retry loops |
| Android hot loop | No subprocess launch and no repeated reflection lookup at three-second cadence |
| Polling failure | Exponential backoff with jitter; visibility and cancellation behavior remains intact |
| Observability | Alerts can distinguish storage pressure, API slowness, sync lag, and adapter failures |

## Review limitations

The benchmark used local Fastify injection and synthetic records, so it excludes Cloudflare, container filesystem behavior, network latency, browser parsing/render time, and real ELM327 timing. Android unit tasks were up to date; no physical-device power, GPS, Bluetooth, Room migration, or offline/reconnect test was run. Production retention volume, traffic concurrency, and current host resource use were not inspected.
