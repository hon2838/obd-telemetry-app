# Execution framework: OBD immediate improvements

## Assignment and execution settings

You are Gemini 3.8 Flash (High), running through Antigravity (`agy`) in:

`/home/hon2838/Documents/Code/OBD App`

The user has authorized execution of the immediate improvements from the stack review and explicitly requested `--dangerously-skip-permissions`. Complete the implementation and validation; do not stop at a plan. Use model `gemini-3.8-flash-high` with high reasoning effort. Routine edits, dependency installation, local builds, and isolated tests are authorized. Preserve existing work. Do not publish, push, deploy to the remote server, modify production records, or install an APK on the head unit as part of this assignment.

Read `GEMINI.md` and `STACK_REVIEW.md`, then inspect the actual code. The review is evidence and context, not a substitute for checking current behavior. Build locally as required by `GEMINI.md`.

## User requirement that must remain true

The head unit must continue polling OBD/GPS and saving readings locally while the vehicle is running without internet. Network connectivity gates uploading, not collection. Pending data must be uploaded when connectivity returns. Do not gate OBD polling on API authentication, server availability, or network availability. If credentials are missing, expired, or revoked, preserve locally queued readings and show the configuration problem. Do not delete pending records during dependency, account, or configuration changes.

“Offline” here means no internet, distinct from ignition/ACC off. Preserve the existing ignition behavior unless an immediate fix requires a documented adjustment. The database rewrite, advanced sync redesign, adaptive polling, and new product features are separate future work.

## Current state: continuation, not a clean checkout

The prior agent was interrupted while starting implementation. Inspect `git status` and all relevant diffs before changing anything. Do not reset or discard the working tree.

Existing user work before implementation included:

- `AndroidApp/app/src/main/java/com/example/obdapp/OBDGatewayService.kt`
- `AndroidApp/settings.gradle.kts`
- `Dashboard/components/TelemetryChart.tsx`
- `GEMINI.md`
- Untracked `AndroidApp/adbwire/`

The review created `STACK_REVIEW.md`.

Partial implementation already performed:

1. Backend packages were installed and pinned to Fastify `5.12.3`, `@fastify/cors` `11.3.0`, `@fastify/helmet` `13.1.1`, and `@fastify/rate-limit` `11.2.0`.
2. Next.js was installed and pinned to `16.3.4`. React remains `18.2.0`; verify Pages Router compatibility and actual build results before changing React unnecessarily.
3. Package locks and local dependencies were updated. Both lockfiles are currently ignored by the repository's broad `*.json` rule and were not previously tracked. Add narrow exceptions for both lockfiles so CI's `npm ci` is reproducible.
4. A draft `Server/authorization.js` was created. **It is not wired into `Server/server.js`, has not been tested, and does not yet fix the running application's authorization.** Review or revise it, then integrate it properly. Its proposed normal-user/admin role distinction still needs a backward-compatible account migration and tests.
5. No changes to `Server/server.js`, containers, dashboard authentication, or the remote shell implementation were completed.
6. Dependency installation reported zero dashboard advisories and four backend advisories (one moderate, three high). Obtain current audit details and resolve applicable dependency issues without blindly applying incompatible forced upgrades. An optional backend dependency install script was blocked by npm's script policy; inspect whether it affects the required build/tests.

A pre-edit source/configuration backup exists at:

`/tmp/obd-immediate-backup-n9wmxe_b`

That backup includes relevant source files and package/config files, but deliberately excludes databases, node_modules, build output, APKs, and JARs. Back up any additional configuration or user-data files before modifying them, following `GEMINI.md`. Do not print credentials or database contents in progress reports or command output.

Before these partial upgrades, all 51 backend tests and the dashboard TypeScript check passed. That is a historical baseline, **not validation of the current partial implementation**. Live hardware and the deployed server were not tested.

## Phase 1: establish a safe, testable baseline

1. Inspect repository instructions, current diffs, manifests, runtime versions, and dependency audits.
2. Make test storage disposable per suite. Several existing tests currently mutate accounts or hard-code `Server/data`; others delete fixed `__test_data_*` directories. Prefer `fs.mkdtempSync` under the OS temp directory, set `OBD_DATA_DIR` before importing the server, and clean up only directories created by the test itself. Do not run the existing suite against a real development store.
3. Record failing tests caused by changed behavior or upgrades. Update old tests that intentionally relied on anonymous API access, while adding explicit rejection tests. Never weaken assertions merely to obtain green results.
4. Keep changes separated conceptually into authorization/accounts, dashboard integration, runtime/dependencies, and remote-shell containment. New helpers/modules are appropriate; a whole-stack rewrite is not.

## Phase 2: enforce backend authentication and authorization

Implement default-deny authentication in Fastify, independent of dashboard middleware. Construct an explicit route/permission matrix covering every registered API route and its HTTP methods.

Public exceptions should be minimal and deliberate: liveness, login, pairing initiation/polling using an unguessable polling token, and any intentionally public installer/APK downloads needed for current installation behavior. Do not make telemetry, routes/GPS, fuel, maintenance, account or device inventory public. Verify public artifacts contain no credentials.

Required behavior:

- Missing or invalid credentials produce 401 on protected routes.
- Authenticated but unauthorized actions produce 403 (or consistent 404 for concealed resources).
- A master/admin identity may administer the intended fleet. Existing legitimate admin ownership must not be lost during migration. A normal user sees and changes only their authorized vehicles and devices.
- Derive paired-device scope from its stored vehicle association. For a device payload omitting vehicle ID, use its paired vehicle; reject explicit mismatches. Check every record before mutating any batch. Do not permit a mixed-vehicle batch to partially persist.
- Device credentials may upload telemetry, DTC results, fuel and maintenance as required by existing Android behavior. They must not create/delete vehicles, claim/revoke other devices, change user passwords, or issue remote diagnostic commands.
- Scope unfiltered reads as well as explicit `?vehicle=` reads. Aggregate/history/latest/trip/performance/fuel/maintenance endpoints must never leak other vehicles when the query parameter is omitted.
- Authorize mutations by the stored resource's vehicle or owner, not just a body/query field. Cover ID-based fuel deletion, maintenance edits/deletion, device revocation, vehicle reassignment, and CSV/GPX exports.
- Vehicle creation must assign ownership. Pairing an existing vehicle requires existing authorization; knowing its ID is not authorization.
- Do not let a stale device token silently acquire access to a newly recreated vehicle ID. Define cleanup/revocation when deleting vehicles and test it.
- Remove obsolete per-route checks that allow absent API keys or conflict with the centralized policy. Avoid repeated expensive authentication inside one request.

### Pairing fixes

- Remove the unauthenticated admin fallback from `/api/auth/device/claim`.
- Require authenticated authorized approval of the target vehicle; validate names, vehicle IDs and relevant size/range limits.
- Generate PINs with cryptographic randomness and avoid collisions with active pairings.
- `/api/auth/device/poll` must accept only the unguessable polling token belonging to that session. The current map also stores the PIN as a key: passing a PIN must never disclose a device credential.
- Make claiming single-use and safe against concurrent/repeated claims. Set/check state before awaits that could admit a second claimant. Remove all expired aliases and cap outstanding sessions.
- Add actual rate limits on login, pairing initiation/polling/claiming and commands; ensure normal device pairing polling still succeeds.

### Account and token fixes

- Replace the predictable bootstrap password with a one-time configurable or generated setup secret. Do not log the secret. If generated, store it only in a permissions-restricted setup file and document where the operator retrieves it.
- Preserve existing customized passwords. Detect and safely migrate an account still using the old known default; document the exact first-login behavior so the user is not stranded.
- Enforce password replacement on the backend, allowing only the narrowly necessary profile/password/logout operations until completed.
- Expire sessions, bound/clean their in-memory storage, support logout, and invalidate old sessions after password change. Existing sessions must not survive revocation through an alternate authentication path.
- Prefer asynchronous password verification to avoid blocking Node's event loop. Keep comparisons timing-safe where applicable.
- Store device token hashes rather than raw tokens where feasible in this immediate scope. Migrate existing raw tokens without changing the credential stored on head units, back up before rewriting, and keep migration idempotent.
- Never include full tokens in list responses, logs, errors or version-control artifacts. If replacing Android credential storage, use a migration that preserves existing pairing and queued records; do not introduce a broad untested Android storage refactor just to finish this phase.

## Phase 3: integrate dashboard and Android compatibility

The browser uses the Next.js API proxy. Its Basic-auth middleware currently calls login for every request and has a separate legacy `DASHBOARD_PASSWORD` bypass. Tightening backend auth must not produce a dashboard that loads but cannot perform any actions.

1. Define one coherent authentication flow. Either implement sessions correctly or retain Basic authentication with a non-session-creating validation endpoint. A middleware pass must never imply authorization at the API.
2. Decide and document migration of the legacy dashboard password. Do not silently grant master API privileges based solely on a frontend-only bypass. Do not embed an API key in browser code or `NEXT_PUBLIC_*` variables.
3. Protect the pairing page and its API operations while keeping head-unit pairing bootstrap endpoints usable. Test the actual signed-in approval flow.
4. Keep the initial-password-change path usable: show the account screen and actionable messages instead of a redirect loop or an unexplained 403.
5. If cookies are introduced, use HttpOnly/Secure/SameSite attributes, bounded lifetime, logout and CSRF protection for mutations. Validate authorization in server handlers even if middleware is bypassed.
6. Configure one intended internal API origin and request deadlines. Avoid retrying a mutation against multiple fallback origins after an ambiguous failure. Forward only required headers and preserve response statuses and binary downloads correctly.
7. Cancel or handle API failures cleanly; do not display misleading success messages for rejected writes.
8. Inspect Android DTC submission: the current working copy appears to call `/api/dtc` and `/api/dtc/clear`, whereas the backend exposes `/api/telemetry/dtc` and `/api/telemetry/dtc/clear`. Verify payload shape, authentication headers and vehicle scope, and fix these integration mismatches if confirmed.
9. Verify telemetry/fuel/maintenance requests use the current shared authentication helper. Keep all queued readings on authorization or network failures. Preserve the user's offline-first requirement throughout.

## Phase 4: finish supported runtime/dependency upgrades

- Verify the installed versions against official support/security documentation and current registry metadata. Use the already-installed versions unless there is a concrete compatibility/security reason to adjust them.
- Move both container runtimes and CI to a supported Node LTS baseline, preferably Node 24. Local Node is currently 26; validation on the intended production Node version is required, using a local container or isolated runtime where available.
- Complete Fastify 5 compatibility changes and use full JSON schemas where required. Confirm every registered plugin is compatible.
- Fix plugin/route registration order. The current limiter installs an `onRoute` hook after synchronous route declarations, and a prior probe observed more than 200 accepted requests despite the nominal limit. Validate actual enforcement through HTTP/injection tests, not by inspecting configuration alone.
- Separate login/pairing/command budgets from dashboard/device budgets. Three-second dashboard polling is 300 requests per 15 minutes per endpoint. Choose limits that allow expected operation, account for shared proxy addresses, and trust forwarded client addresses only from configured trusted proxies.
- Complete Next.js 16 build/config changes, including the removed `next lint` command and any necessary TypeScript/tooling updates. Preserve Pages Router behavior and the existing chart changes. Avoid unnecessary React/chart migrations if supported combinations pass.
- Add narrow `.gitignore` exceptions for `Server/package-lock.json` and `Dashboard/package-lock.json`; ensure `npm ci` works on a clean checkout.
- Add `.dockerignore` files so `COPY . .` does not package local dependencies, `.next`, secrets, tests' data directories, or runtime stores. Use `npm ci` in builds. Prefer minimal non-root runtime stages, but ensure persistent volume permissions and APK distribution continue to work.
- Run dependency audits and address remaining actionable production advisories. Record any unresolved issue accurately, with package path and reason; do not claim zero advisories unless verified.
- Fix release-validation assumptions if touched: current CI expects ignored staged APK/version/install files without building them. A fresh checkout must have a viable build/staging path. Build APKs locally/CI, never on `hon2server`.

## Phase 5: contain the unauthenticated remote shell

`AndroidApp/adbwire` is new, uncommitted user work. Preserve its source. Its current ADB-like port 5555 and raw-shell port 7777 listeners have no authentication and execute with the app's effective privileges.

For this immediate patch, prefer containment rather than inventing a new remote-administration protocol:

- Exclude the module from normal app/release builds unless an explicit developer-only opt-in is provided.
- Disable its release variant or enforce an equivalent build-time safeguard.
- Ensure default execution cannot expose an unauthenticated listener on all network interfaces. A loopback-only development binding is acceptable if clearly reflected in its UI/documentation.
- Do not add a root requirement, weaken platform security, or publish shell endpoints through the tunnel.
- Verify default Gradle project/task configuration does not build/package this module as part of a production release. Retain a documented developer path for future work on the module.
- Explain that previously installed copies are not remotely changed by a source/build fix; do not claim the head unit is protected without installation/runtime verification.

## Acceptance tests: required before completion

Use disposable credentials and data. Extend existing tests rather than replacing them wholesale.

### API authorization

1. Every protected route/method rejects anonymous and invalid credentials.
2. Anonymous fuel create/delete, maintenance edit/delete, DTC ingestion and device revocation are denied.
3. Create two ordinary users and two vehicles. Test both explicit and omitted query scopes, resource-ID mutations and exports; no cross-user access succeeds.
4. A paired token uploads only to its vehicle. Omitted ID maps to its vehicle; a mismatch or mixed batch changes no records.
5. Device tokens cannot issue commands, pair devices, mutate the garage or manage accounts.
6. Vehicle deletion/reassignment cannot grant new access or leave an active token attached to a reused ID.

### Pairing/accounts

7. Anonymous claim fails; authenticated owner approval and head-unit poll succeed.
8. PIN-as-poll-token fails; wrong/expired poll tokens disclose no credentials; repeated/concurrent claims cannot create multiple devices.
9. Existing customized admin login survives migration; a fresh install has no predictable default login; forced reset remains usable.
10. Expired/revoked sessions fail; password change invalidates older sessions; logout works.
11. Token-at-rest migration, if implemented, preserves existing device authentication and is safe to rerun.
12. Login/pairing/command throttles actually return 429 at their thresholds, and normal dashboard polling is not throttled.

### Integration/build

13. Existing backend analytics, persistence, vehicle, health and artifact tests pass under the new policy.
14. Dashboard typecheck and production build pass on the chosen Node LTS runtime.
15. Browser tests cover sign-in, forced reset if applicable, pairing, vehicle switching, fuel/maintenance actions, and unauthorized states—not just headings.
16. Android compiles for the supported head unit. Verify DTC request routes/headers and foreground/offline behavior through appropriate tests or an explicit hardware-test checklist when hardware is unavailable.
17. Simulated loss of internet/server/auth does not stop collection or remove queued records. Do not pretend an actual Bluetooth/head-unit test was run if only mocks/source inspection were possible.
18. Default release build excludes unauthenticated `adbwire`; opt-in development access follows the new restrictions.
19. Clean install/build from committed manifests and lockfiles works. No secrets, runtime records, generated credentials or unrelated user changes enter the patch.

## Execution and reporting discipline

Work through the phases, adapt implementation details to the code, and continue resolving failures within this scope without repeatedly requesting permission. Keep progress updates concise. Do not run destructive commands against production or overwrite unrelated user work. If a tool rejects an action, report the actual rejection; do not claim the permission flag bypassed an external block.

Create `IMMEDIATE_IMPROVEMENTS_RESULT.md` containing:

- What is implemented, grouped by user-visible behavior/security boundary.
- The exact changed files and dependency/runtime versions.
- Tests/builds/audits executed, their results and any limitations.
- Required configuration changes and a precise account/bootstrap migration procedure, without secrets.
- Local build/release instructions and rollback notes; no deployment claim.
- A clear distinction between completed scope and future sync/database/features work.
- A statement confirming preservation of offline polling and deferred upload behavior, with the evidence used to assess it.

Leave a cohesive, reviewable working-tree patch. Do not create commits or push unless explicitly requested later. End with an honest completion report: do not mark this complete while authentication is merely in an unused helper, builds fail, or required tests are missing without an explicit environmental limitation.
