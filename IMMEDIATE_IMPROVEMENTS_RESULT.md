# Immediate improvements: implementation and final review

**Repository:** `/home/hon2838/Documents/Code/OBD App`  
**Reviewed:** 2026-09-05  
**Implementation run:** Gemini 3.8 Flash High through `agy`, followed by a Codex code review and corrective pass  
**Status:** Locally complete; no production deployment or hardware installation was performed

## Outcome

The immediate security, dependency, dashboard-integration, test-isolation, Android route-alignment, and `adbwire` containment work is implemented and passes local validation. The final review found and corrected integration defects that remained after the delegated run:

- Fastify trusted every forwarded IP by default, which weakened IP rate limiting. `OBD_TRUST_PROXY` now defaults to `false` and accepts an explicit boolean or trusted proxy list.
- Admin authorization depended partly on the username `admin`. It now depends on the persisted role or reserved admin ID.
- A single-vehicle user could pass authorization without a `vehicleId`, then route code stored the record against `default`. Authorization now injects the sole authorized vehicle. A multi-vehicle user must provide an explicit vehicle ID.
- Master-key login created a bearer session that was later interpreted as a normal user session. Master session identity is now retained.
- The predictable legacy `admin12345` credential was only flagged for later change. Startup now replaces it with a configured or generated temporary secret, creates a backup before rewriting `users.json`, and forces a password change.
- Dashboard authentication could fall back to a disconnected environment password and `/pair` was outside the authentication matcher. The fallback is removed and pairing approval is protected.
- Compose omitted the dashboard's private backend address. It now sets `INTERNAL_API_URL=http://server:3000` and passes the supported server bootstrap/proxy settings.
- Docker build contexts could include `.env` files. Both `.dockerignore` files now exclude all local environment files while allowing `.env.example`.
- The Next.js 16 middleware convention generated a deprecation warning. Authentication moved to `Dashboard/proxy.ts`.
- Deployment instructions built on the production server and documented stale ports and variables. They now require local validation/building and transfer of finished images.
- Four development dependency advisories were resolved without forced upgrades. Full audits now report zero vulnerabilities for both Node projects.

## Backend and authentication

`Server/authorization.js` installs a default-deny `preHandler`. Only health, installer/APK distribution, login, pairing initiation, and high-entropy pairing-token polling are public. Protected reads and writes are scoped to admin, ordinary-user, or paired-device vehicle access.

The implementation includes:

- constant-time master-key comparison and a required `OBD_API_KEY` of at least 32 characters;
- expiring, bounded bearer sessions with logout and password-change revocation;
- forced password replacement for bootstrap accounts;
- async scrypt verification and runtime password hashing;
- hashed device tokens at rest and a backup-first legacy token migration;
- separate six-digit pairing display codes and 256-bit poll tokens;
- single-use pairing claims and scoped device credentials;
- atomic validation of all vehicle IDs before batch mutation;
- rate limits on the global API, login, pairing, polling, command, and telemetry paths;
- explicit rejection of device credentials for commands, garage changes, pairing approval, and account operations;
- canonical DTC endpoints plus compatibility aliases for older clients.

The generated bootstrap password is stored at `<OBD_DATA_DIR>/.initial_admin_secret` with mode `0600` when `OBD_INITIAL_ADMIN_PASSWORD` is omitted. A successful admin password change removes the file. Existing `users.json` data receives a timestamped backup before startup migration.

## Dashboard and container integration

The dashboard proxy uses one upstream origin, forwards Basic, Bearer, API-key, and device-token credentials, applies a 15-second timeout, and preserves binary responses such as APK downloads. It does not retry mutations across several hosts.

`Dashboard/proxy.ts` validates browser credentials through `GET /api/auth/me` without creating a new backend session on every page request. A required password change redirects UI navigation to `/account`. Backend rejection returns `401`; backend unavailability returns retryable `503` rather than granting access.

The production Compose network now supplies `INTERNAL_API_URL=http://server:3000`. Browser-facing builds still use `NEXT_PUBLIC_API_URL`. The API maps host port `3000`; the dashboard maps host port `3003` to container port `3001`.

Both Dockerfiles use Node 24 and reproducible `npm ci` installs. The server image installs production dependencies only. Lockfiles are present for the server and dashboard.

## Android behavior

The Android service sends DTC results to `/api/telemetry/dtc` and clear results to `/api/telemetry/dtc/clear`. Existing legacy server aliases remain available for already-installed APKs.

The user's offline requirement is preserved in the implementation:

1. OBD and GPS collection runs independently of internet availability and writes records into Room.
2. The sync loop checks connectivity before loading and posting pending telemetry, fuel, and maintenance rows.
3. Network errors, timeouts, and non-2xx responses leave rows unsynced.
4. Rows are marked synced and deleted only after an HTTP 2xx response.
5. The loop retries later and uses bounded backoff when every attempted upload fails.

This behavior was confirmed by code inspection and an Android debug build. It still needs an end-to-end airplane-mode/reconnection test on the FYT head unit because no hardware was attached to the local review environment.

## `adbwire` containment

The untracked `AndroidApp/adbwire` application contains raw shell behavior and is unsuitable for production exposure. The immediate patch contains it as follows:

- the module is absent from the default Gradle project graph;
- inclusion requires `-PincludeAdbwire=true` or `OBD_INCLUDE_ADBWIRE=true`;
- only the debug variant is generated;
- both listeners bind to `127.0.0.1`.

This is containment, not an authenticated remote-administration design. Do not distribute it as a production feature until it has explicit authentication, short-lived enablement, authorization, audit logging, and a threat-model review.

## Verification evidence

| Check | Result |
|---|---|
| Backend Jest | 10 suites passed; 66 tests passed |
| Backend full dependency audit | 0 vulnerabilities |
| Backend production dependency audit | 0 vulnerabilities |
| Dashboard TypeScript | Passed |
| Dashboard production build | Passed; 11 pages generated; no middleware deprecation warning |
| Dashboard dependency audit | 0 vulnerabilities |
| Android `:app:assembleDebug` | Passed |
| Default Gradle projects | Only `:app`; `:adbwire` excluded |
| Opt-in `adbwire` tasks | Debug tasks present; no `assembleRelease` task |
| Server Podman image build | Passed using `node:24-alpine` |
| Dashboard Podman image build | Passed using `node:24-alpine` |
| Container smoke test | API and dashboard health returned 200; dashboard root returned 401 without auth and 200 with valid master Basic auth; `/pair` returned 401 without auth |
| Compose structure | YAML parsed; required network URL and port mappings asserted |
| Git whitespace check | Passed |

The local host has Podman but no Docker Compose provider. The two images were therefore built directly with Podman and exercised together on an isolated Podman network. Compose interpolation and lifecycle must receive one final check on the actual deployment host before promotion.

## Remaining prioritized work

These items were intentionally left outside the immediate patch and remain the next engineering phase:

1. **Durable, idempotent synchronization.** The server still acknowledges telemetry before its asynchronous JSON persistence is proven durable, and persistence errors are logged rather than returned. Add stable event IDs, unique constraints, transactional commits, per-record acknowledgments, and Android deletion only for acknowledged IDs.
2. **Transactional storage.** Replace whole-file JSON serialization and in-memory history scans with SQLite or PostgreSQL. Index vehicle and capture time, add retention/rollups, and expose storage readiness and disk capacity in health checks.
3. **Command lifecycle.** Persist command IDs and queued, delivered, acknowledged, completed, failed, and expired states. Do not remove a command merely because it was attached to an upload response.
4. **Android job ownership.** Consolidate the foreground-service and worker sync implementations, make repeated service starts idempotent, add cancellation/read deadlines, and schedule connectivity-triggered catch-up.
5. **Credential storage.** Protect Android device credentials with Keystore-backed encryption and explicit backup exclusions.
6. **Dashboard session UX.** Replace browser-managed Basic authentication with a secure HttpOnly session cookie, CSRF protection for cookie-authenticated mutations, and a clear login/logout flow.
7. **Performance and product features.** Add downsampled time-series queries, paginated trips, sync-lag indicators, pending-record age, device/app version status, trip correction tools, alert history, and reliable offline summaries.

See `STACK_REVIEW.md` for the full architecture and feature roadmap and `deployment_guide.md` for the corrected release procedure.
