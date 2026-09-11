# Independent final review — 2026-09-06

> Resolution update: the findings below were resolved in the subsequent Gemini final-fix pass and independent follow-up review. See `GEMINI_FINAL_FIX_REPORT.md` for the implementation and current verification results. This document remains as the pre-fix evidence record.

## Verdict

Not ready for deployment. This review supersedes the unconditional RESOLVED assertions added by the implementation agent to INTEGRATION_REVIEW.md. Application source was not edited during this review. Two server failures were independently reproduced in disposable data directories.

## P1: A subsequent request destroys an unfinished recovery journal

Location: Server/server.js:146, :163, :178, :395.

After a staging-to-final rename fails, a COMMITTING journal remains, but the handler returns 503 and the process keeps accepting requests against its old in-memory stores. A new transaction overwrites the same journal path without checking for an outstanding transaction. It then deletes that journal on success, abandoning recovery of the original operation.

Disposable probe: create review-car and one telemetry row, fail the fuel-file rename during reassignment, restore the filesystem function, then create second-car without restarting:

```json
{"failedStatus":503,"pendingJournalAfterFailure":true,"nextMutationStatus":201,"journalAfterNextMutation":false,"diskVehicle":"default","memoryVehicle":"review-car"}
```

Correction: after any uncertain commit, stop serving state-dependent reads/writes until recovery and complete store reload succeed, or fail closed and restart. Never replace an unresolved journal. Test a failure followed by another request and then restart, not only immediate restart after failure. Device-claim retries need the same protection; successful roll-forward must not be mistaken for a clean rollback.

## P1: Command enqueue races the transactional drain and resurrects delivered commands

Location: Server/server.js:1567 and :1570.

POST /api/commands mutates pendingCommands directly and calls asynchronous persist outside serializeMutation. Its queued snapshot can overwrite the transactional command-drain result after the upload responds.

Disposable probe: pause the command enqueue's temporary-file write, ingest telemetry and let its transaction drain the queue, then release the old enqueue write:

```json
{"enqueueStatus":200,"deliveredCommands":["clear_dtc"],"persistedQueue":[{"command":"clear_dtc","vehicleId":"default"}]}
```

A restart restores a command already delivered. Correction: serialize validation, capacity checking, snapshot persistence and memory commit for command enqueue with all other mutations. Add a deterministic paused-write regression test. This issue can be fixed without implementing the larger future command-acknowledgment protocol.

## P1: Single-file upload acknowledgments still lack durable flushes

Location: Server/server.js:371, :379, :380; used by fuel and maintenance ingest.

The single-file persist helper writes and renames but never fsyncs the file or its containing directory. Fuel/maintenance success can therefore authorize Android to delete its local copy before the acknowledged data is durable against host power loss. Multi-file transactions use a different, fsynced helper, so the durability guarantee differs by endpoint.

Correction: use one consistent durable write implementation, flushing the temporary file before rename and the directory after rename, with failures surfaced to callers. Directory fsync errors must not be blanket-suppressed on the Linux production target. This finding is verified from code; no power-loss experiment was performed.

## P2: Android cancellation does not actively stop the blocking operation as claimed

Location: AndroidApp/app/src/main/java/com/example/obdapp/HttpTransport.kt:40 and :46.

The disconnect callback is registered using the default completion handler on the outer Job. It runs after completion, rather than immediately when the inner timeout begins cancellation. The blocking HttpURLConnection work inside withTimeout does not suspend to observe cancellation. A slow trickle response can keep readText running beyond the claimed 45-second overall deadline; the disconnect in finally only happens after I/O returns.

Correction: use a cancellable HTTP call or a suspendCancellableCoroutine bridge with invokeOnCancellation disconnecting/cancelling the actual request. Test cancellation during blocked writes and a slow trickle response with a short overall deadline. No physical-device cancellation test was performed in this review.

## Improvements confirmed by inspection

- MainActivity's old immediate fuel HTTP/deletion block is replaced with the shared uploader.
- Permanent validation failures have a distinct disposition and retain queued rows while allowing other resources/vehicles to proceed.
- Fuel and maintenance forms require a specific authorized vehicle.
- Chart cursor work is bounded per poll.
- Cookie/CSRF browser tests and Room JVM migration tests now exist. Their presence improves coverage but does not establish correctness of unrelated concurrency or crash behavior.

## Checks performed independently

- Backend: npm test -- --runInBand — 12 suites, 82 tests passed.
- Dashboard: npm run lint — passed.
- Android: :app:assembleDebug :app:testDebugUnitTest --no-daemon — successful; Gradle reported all 45 tasks up-to-date, so this was a cached validation, not fresh test execution.
- Two isolated Fastify fault/race probes above, with test-only credentials and temporary stores cleaned after fastify.close().
- git diff --check reports trailing whitespace in AndroidApp/app/src/main/java/com/example/obdapp/TelemetryDatabase.kt:68 (minor cleanup).

Browser suite, container runtime and physical-device tests were not rerun in this pass. No production state was accessed or changed.
