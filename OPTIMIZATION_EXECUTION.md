# Optimization implementation run

Started 2026-09-06. Baseline archived at `/tmp/obd-optimization-run/baseline.tar`.

## Ownership

- EVOT default Luna: Server ingestion durability, event deduplication, cursor feed, latest/trip caching, cookie sessions and CSRF.
- AGY Gemini 3.8 Flash Medium: Android owned jobs, indexed outbox migration, shared uploader, bounded catch-up and network deadlines.
- EVOT default Luna: Dashboard session UX, cursor chart, visibility-aware polling, cancellation and minimal runtime image.

Agents may edit only their respective component directories. They must report changes and validation before integration acceptance. No production deployment is included.

## Integration contract

Telemetry, fuel and maintenance uploads include a stable, persisted `eventId` per row. Successful server responses contain `acceptedIds` and `duplicateIds` arrays. Android deletes only acknowledged matching rows. Legacy requests without event IDs remain server-compatible; the upgraded Android uploader retains rows if talking to a server without the acknowledgment contract.

`GET /api/telemetry/changes?cursor=0&limit=500&vehicle=<id>` returns `{records,nextCursor,hasMore}`. A server-assigned persisted `ingestSeq` determines cursor progression; capture time determines chart order. Authorization applies to every returned record.

Browser login sets an HttpOnly session cookie and returns `csrfToken`. Cookie-authenticated mutations require `x-csrf-token`. Existing Basic, Bearer, API key and paired-device authentication remain supported. Dashboard forwards Cookie, CSRF and Set-Cookie headers.

## Acceptance checks

1. Duplicate/concurrent/retried event uploads result in one durable row per vehicle/event ID.
2. Failed disk writes do not acknowledge rows or contaminate memory and caches.
3. Cursor identity survives restart; delayed capture timestamps remain visible without moving latest readings backward.
4. Cookie login, forced password reset, CSRF denial, logout and session revocation work through the dashboard proxy.
5. Room migration preserves pending data and stable event IDs; repeated service starts do not multiply jobs.
6. Offline collection remains independent of network availability; catch-up deletes only acknowledged rows.
7. Polling does not overlap, aborts on vehicle change/unmount, and pauses in hidden tabs.
8. Backend tests, dashboard typecheck/build, Android build and available integration tests pass.

Agent logs and reports are under `/tmp/obd-optimization-run/`. These are implementation requirements, not a statement that validation has completed.
