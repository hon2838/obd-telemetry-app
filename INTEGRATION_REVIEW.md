# Optimization integration review — 2026-09-06

Reviewer: Command Code `meta/muse-spark-1.3-contributor`, followed by Codex verification. Review-only: application files were not changed.

## Verdict

Do not promote this optimization patch yet. Compilation and the existing tests do not cover several integration defects. The following findings are verified from the implementation; the multi-file persistence failure was also reproduced with a disposable data directory.

## P1 findings

1. **Immediate fuel logging bypasses the shared outbox.** `AndroidApp/app/src/main/java/com/example/obdapp/MainActivity.kt:261` still independently uploads pending fuel rows without `eventId`, then deletes them on any 2xx. A background upload racing this path can store the same refuel twice. Route this path through the shared serialized uploader and delete only acknowledged event IDs.

2. **One permanently invalid batch blocks other vehicles.** `AndroidApp/app/src/main/java/com/example/obdapp/OutboxUploader.kt:309` treats non-success responses other than 401/403 as network failures. The outer loop at line 134 stops processing all vehicles after this failure. A persistent 400 can therefore starve valid queued rows. Retain and visibly quarantine invalid rows or skip the affected batch/vehicle; reserve global backoff for retryable transport/server failures. Do not discard rejected records.

3. **Multi-file vehicle reassignment is not transactional.** `Server/server.js:2297` writes several candidate files sequentially before changing memory. Injecting failure on the fuel-file rename produced HTTP 503 while telemetry on disk had already moved to `default` and memory still associated it with `review-car`. Restart exposes a partially completed operation. Candidate snapshots alone do not solve this: use a recoverable transaction/journal or transactional database across affected stores. Review vehicle creation and device claiming for the same pattern.

4. **Fleet-wide forms silently target the default vehicle.** `Dashboard/pages/fuel.tsx:110` and `Dashboard/pages/maintenance.tsx:121` replace the All Vehicles selection with `default` on create. Admin users can save data to the wrong car; users without access receive a denial. Require an explicit authorized vehicle choice before a mutation.

## P2 findings and remaining validation

- `Dashboard/components/TelemetryChart.tsx:230` loads cursor pages from zero, up to 1,000 pages of 500 records, accumulating results before trimming the chart to 2,000 points. Bound work and memory per poll and use a consistent recent-history/cursor handoff.
- Remaining direct Android HTTP paths, including the immediate fuel action, lack read/overall deadlines. The shared transport adds read deadlines but does not actively interrupt blocking I/O when its coroutine is cancelled.
- Browser tests largely check rendered headings using Basic credentials. Add actual cookie login, CSRF denial/success, password reset, logout and stale vehicle/cursor interaction tests through the Next proxy. Passing those heading tests does not establish session integration.
- Room migration 7→8 has backfill/index code, but no executed migration test was supplied. Newly added older migrations must be checked against actual historical schemas; their presence is not proof of compatibility. Test preserved pending rows and event IDs with Room schema validation before releasing the APK.

## Corrections to the raw Muse report

The raw report is `/tmp/obd-optimization-run/muse-integration-review.md`. It contains useful findings but is not accepted verbatim:

- The API proxy is **not empty**. Codex read `Dashboard/pages/api/[...path].ts` directly and confirmed Cookie, Authorization, CSRF and Set-Cookie forwarding. Muse's bracketed-filename read failed.
- No unconditional P0 classification is established. The substantiated data-integrity and queue issues above are P1 release blockers for this patch.
- Never grant default-vehicle access to an account with no assigned vehicles. Show an empty-state/assignment flow while retaining authorization.
- The legacy chart key already contains the vehicle prefix; no cross-vehicle collision was established by that claim.
- Writing several candidates before updating memory is insufficient to make a multi-file operation atomic, as the isolated failure probe demonstrates.
- Older migration function declarations do not prove historical schema correctness.

## Validation evidence

Muse performed static source review. Command Code headless permissions blocked its shell and report-file tools, so it did not execute tests. Codex retrieved the proposed report from that task's transcript and saved it locally without changing application code.

Codex ran a disposable Fastify injection probe using `mkdtemp` and a test-only API key, injected a rename failure, and cleaned up the directory after closing Fastify:

```json
{"case":"partial vehicle reassignment","status":503,"memoryVehicle":"review-car","diskVehicle":"default"}
```

The existing backend suite was rerun separately: **11 suites and 74 tests passed**. Hardware offline/reconnect behavior, actual Room migrations and full cookie browser flows remain unverified in this review. No production data, deployed service, or APK installation was touched.

## Resolutions — Muse Free implementation run (2026-09-06)

Worked from the project root on top of the uncommitted optimization
changes (pre-fix snapshot `/tmp/obd-muse-free-fix/pre-fix.tar.gz`). No
commits, pushes, deployments, production data, or APK installs. Full
evidence log: `/tmp/obd-muse-free-fix/result.md`.

1. **Immediate fuel logging → shared outbox. RESOLVED.**
   `MainActivity.kt` now inserts the row and calls serialized
   `OutboxUploader.drainOutbox()`; the old no-`eventId` HTTP path and
   mark-synced/delete-all logic are deleted. Delivery uses stable
   `eventId`s with ack-intersection deletes only; offline rows persist
   and the UI reports synced/offline/rejected/unauthorized. Verified by
   `:app:assembleDebug` BUILD SUCCESSFUL (no on-device run per
   constraints).
2. **Invalid batch starves queue. RESOLVED.**
   `OutboxUploader.kt` gains `FAILED_PERMANENT_VALIDATION`: 400/404/422
   (any non-2xx except 401/403/429/5xx) retains rows, records
   `quarantinedVehicles`/`quarantinedCount`, skips only that resource for
   the drain, and lets other vehicles/resources proceed; 429/5xx/network
   keep global backoff. Verified by `:app:assembleDebug` BUILD
   SUCCESSFUL; on-device queue behavior remains hardware-unverified.
3. **Multi-file operations not transactional. RESOLVED.**
   `Server/server.js` implements a write-ahead journal
   (`txn_journal.json`, PREPARED rollback / COMMITTING roll-forward,
   fsynced staging, startup recovery BEFORE store loads, fail-closed on
   corrupt/failed recovery) covering vehicle delete+reassign, vehicle
   creation, device claim, DTC read/clear, and telemetry+command drain;
   PUT vehicle, device revocation, and change-password are serialized.
   Evidence: full backend suite **12 suites / 82 tests pass**, including
   new `Server/transaction.test.js` (staging-failure rollback, injected
   second-file commit failure → child-process restart roll-forward with
   consistent disk+memory, PREPARED rollback, corrupt-journal fail-closed,
   claim/revocation/concurrency regressions). A disposable change-password
   probe (bootstrap → reset → relogin → authorized read) passes.
4. **Fleet-wide forms coerce to default. RESOLVED.**
   `Dashboard/pages/fuel.tsx` and `maintenance.tsx` require an explicit
   authorized vehicle: submit disabled with a guard message (no
   left-border styling), handler re-checks, button names the target.
   Evidence: `tsc --noEmit` clean, `next build` success, and a new
   Playwright session suite passing **12/12** with disposable backend
   credentials (cookie login incl. HttpOnly, CSRF deny/allow through the
   proxy, reset rejection, logout revocation, stale vehicle/cursor 400s).
   No hardcoded legacy password remains in the suite.

**P2 dispositions.** Chart cursor handoff bounded (4×500/page-poll,
cursor-advanced convergence; `tsc`+build pass). Shared Android transport
actively disconnects on cancellation with a 45 s overall deadline and all
remaining direct HTTP paths carry read deadlines (compile-verified only).
Room 7→8 has an executed migration test: 3 Robolectric JVM tests pass
(pending-row preservation, eventId backfill, index/schema validation via
Room's own open-time check, full 4→8 chain); the mirrored instrumented
test compiles but is **NOT executed** — the `api29test` emulator
segfaults during boot in this environment (4 configs tried) and the
attached physical device was off-limits (no APK installs). Historical
migrations 2→3/3→4/5→6/6→7 were verified against git history (with a
real DDL correction to the new 4→5 leg); 1→2 is a no-op anchor (v1 never
shipped in-repo). The browser suite additionally fixed a genuine proxy
defect (forced `Content-Type` on bodyless POSTs broke logout with 400).

**Remaining hardware-only gaps:** on-device outbox races,
offline/reconnect behavior, instrumented migration execution, and a real
v7→v8 store upgrade were not exercised.
