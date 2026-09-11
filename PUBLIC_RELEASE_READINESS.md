# Public self-deployment readiness review

Reviewed 12 September 2026 against `c9eb9d578b8ae4ff25948b4c2bda2bf41b478be4`. Local HEAD matches GitHub `main`. GitHub reports the repository as private, with no releases listed. The latest CI run for this commit succeeded.

**Decision: not ready to recommend to novice self-deployers.** The core application has useful automated coverage and substantially improved authentication and synchronization. A new operator still encounters deployment-specific pairing failures, an incomplete HTTPS setup path, excessive device credentials in the instructions, and a developer-oriented distribution process. A technical preview is a more accurate description, after publication hygiene is resolved.

This was a review. Application code, production services, repository visibility, and device installations were not changed. EVOT independently reviewed deployment and packaging; its findings were checked against the implementation before inclusion.

## Verified results and limits

| Check | Result |
| --- | --- |
| Server Jest suite | 12 suites, 84 tests passed |
| Dashboard TypeScript check and production build | Passed |
| Dashboard Playwright suite | 12 tests passed, none skipped; disposable backend and credentials |
| Android debug build and JVM test task | Successful; Gradle reused up-to-date outputs. Existing reports contain 13 passing tests across acceleration, migration, and transport |
| Dependency audit | Server production dependencies and full dashboard audit each reported zero known vulnerabilities |
| Production-mode login probe | Plain HTTP on a non-loopback hostname failed to retain the session; loopback login reached the forced password-change screen |
| Pairing probe | A fresh backend returned the owner's hard-coded dashboard domain in its QR URL |
| Shared-key privilege probe | The configured `OBD_API_KEY` authenticated as administrator with an arbitrary username |
| Unauthenticated vehicle read | Rejected with HTTP 401 |
| APK inspection | Debuggable, Android Debug certificate, version 1.2.0/code 3, target SDK 29 |
| GitHub CI | [Successful run for the reviewed commit](https://github.com/hon2838/obd-telemetry-app/actions/runs/34640910087) |

These checks used installed local dependencies; they do not establish a clean-machine installation. Docker Compose was unavailable here, so no complete Compose deployment, image-build smoke test, or backup/restore execution was performed. No Android device was connected. Actual Bluetooth, head-unit boot behavior, offline collection/reconnect, and instrumented migrations remain unverified in this review. The dependency audits and limited credential scan are not a full security audit.

## Release blockers

### 1. Pairing sends self-hosted users to another installation

`Server/server.js:2903` always returns `https://obd.hon2838.name.my/pair?...`. Android repeats this domain in its instructions and fallback (`MainActivity.kt:429`, `:475`), and its default API URL is also the owner's server (`ApiConfig.kt:8`). Changing the API address does not change the server-generated QR destination. Scanning a QR from a new deployment therefore opens the wrong dashboard; the pairing session exists on the new backend and cannot be claimed there.

**Required:** Make the public dashboard URL a validated deployment setting, generate pairing links from it, and remove personal domains from default mobile configuration and onboarding. Test a deployment under two entirely different hostnames.

There is also a configuration defect in `Makefile:78-85`: it says it uses `.env` but never loads that file, falling back to the owner's API domain. However, the current browser API helper uses same-origin requests (`Dashboard/api.ts:1-3`) and Compose supplies `INTERNAL_API_URL=http://server:3000`. The normal Compose dashboard is therefore **not proven to send browser API traffic to the owner's server**. That broader claim from the packaging review was not accepted. Fix the Makefile and fallback configuration without misdiagnosing the same-origin proxy.

### 2. The suggested LAN path conflicts with production authentication and Android networking

`.env.example:27-28` suggests LAN-only use, while Compose enables `NODE_ENV=production` and `Server/server.js:844-846` always adds `Secure` to session cookies. There is no ready-to-run HTTPS service in Compose; the guide supplies a tunnel ingress fragment without the complete setup procedure.

The production browser probe returned HTTP 200 from login at `http://obd-review.test:33271`, but the browser stored no session, `/api/auth/me` returned 401, and navigation ended at `/login`. With the same build and credentials on `127.0.0.1`, the cookie was stored and navigation reached `/account`. This is consistent with [Secure-cookie behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

Android accepts `http://` in its settings (`MainActivity.kt:202`) but targets SDK 29 and has no cleartext opt-in in its main manifest. On the intended Android 10 platform, the [default network policy rejects cleartext traffic](https://developer.android.com/privacy-and-security/security-config). This Android consequence was established from configuration and platform documentation, not a hardware run.

**Required:** Provide one complete, tested HTTPS setup with a connection check and clear error messages before login/pairing. State exactly what LAN deployment supports. Preserve secure production cookies. For the documented host proxy/tunnel arrangement, bind ports to loopback instead of all interfaces (`docker-compose.yml:17` and `:50`); offer any direct LAN exposure as an explicit configuration.

### 3. The instructions provision phones/head units with an administrator credential

`.env.example:7-10` describes `OBD_API_KEY` as an ingestion secret that must be entered into Android. `deployment_guide.md:28` repeats that shared-key workflow. In fact, `Server/server.js:2670-2682` accepts that key as an administrator login password, and `Server/authorization.js:4-7` treats master credentials as administrators.

The isolated probe confirmed administrator access using the key and an arbitrary username. This is an intentional master-key capability whose scope is misrepresented in onboarding, rather than an unauthenticated bypass. Distributing it to every device greatly expands the impact of losing a head unit.

**Required:** Make the existing scoped device-pairing flow the default. Clearly label the master key as a server/operator credential and keep it out of ordinary Android setup. Document device revocation and re-pairing. If legacy ingestion keys remain supported, give them separate restricted privileges.

### 4. There is no dependable novice release bundle

The release guide builds Android and then runs `make build` (`deployment_guide.md:48-55`). `make build` builds images only; `apk-bundle` is the step that copies the APK, metadata, and installer into the server context (`Makefile:51-65`). A fresh checkout contains only `Server/agent/.gitkeep`, so the main documented path can produce healthy containers with no downloadable APK. The API's remediation text refers to a nonexistent `make apk-and-server` target (`Server/server.js:3166-3185`).

The current workflow explicitly succeeds when APK artifacts are absent (`.github/workflows/ci.yml:65-67`). It neither builds Android nor builds/smoke-tests the two container images. There are no GitHub releases listed, and the documented process requires Node, an Android SDK/JDK, Make, Podman, image transfer, and Docker Compose.

The staged artifact is `app-debug.apk`. Inspection confirmed a debuggable application signed by an Android Debug certificate. A stable signing identity is needed for predictable upgrades; Android documents the difference between [debug and release signing](https://developer.android.com/studio/publish/app-signing).

**Required:** Publish versioned prebuilt images for declared supported architectures, a release-signed APK, checksums, release notes, and a matching deployment bundle. Keep builds in CI/on the development workstation. Require the release job to build and verify every artifact and exercise download endpoints. Do not solve packaging by committing APK binaries into the source tree.

### 5. The installer and first-run instructions stop short of a configured device

`static/install.sh:66-85` requires root, Bash, `curl`, and Android's `pm`; it is not a general unrooted-head-unit installation flow. It requires `--api-key` but never uses the key after checking it is nonempty. `--api-url` changes the download source, not the installed app's configuration, and `--node-id` is only logged. The error at line 89 directs users to `/api/admin/agent-config`, which has no implemented route.

The generated administrator password is safely stored inside the data volume, but the guide never gives the container command to retrieve it. It also does not walk through the full first-login, password-change, APK installation, permission, Bluetooth selection, and pairing sequence.

**Required:** Document a normal APK sideload flow that does not require root. Treat the shell installer as an optional supported advanced path; remove its unused secret arguments or implement a separately reviewed provisioning mechanism. Add a short setup wizard/checklist with screenshots and actionable failures. Include the bootstrap retrieval step, for example `docker compose exec server cat /app/data/.initial_admin_secret`, and explain when that file is removed.

### 6. Backup and fault recovery require undocumented operator knowledge

The backup example hard-codes `obd-telemetry-app_server-data` (`deployment_guide.md:117`). Compose does not pin that volume name, so a different checkout/project name can select a different volume. The example also copies live multi-file storage without stopping writes or obtaining a consistent snapshot, and there is no restore or rollback procedure.

After an uncertain persistence commit, `Server/server.js:99-124` deliberately keeps the process alive while rejecting all requests, including health checks, with 503 until restarted. That protects data consistency, but Compose's `restart: always` does not restart a process merely because its health check fails: [Docker restart policies act when containers stop](https://docs.docker.com/engine/containers/start-containers-automatically/). Novices have no documented recovery sequence for this state.

The guide also promises build identity at `/healthz`, but the API response at `Server/server.js:3137-3146` reports package version 1.0.0 without commit/time, even though deployment build settings use service version 1.2.0.

**Required:** Resolve the actual project volume, produce a consistent backup, and test restoration into a fresh instance. Document disk-full and persistence-failure recovery, preserving the journal and restoring writable storage before restart. Add bounded automatic recovery if desired. Expose the actual release identity so users can verify upgrades and rollbacks.

### 7. Publication hygiene is incomplete

No tracked license, security-reporting policy, or contributor/support guide was found. More importantly, the retained history contains embedded credential defaults in commit `685ad1a3`, in `ApiConfig.kt:9` and `Dashboard/middleware.ts:5`. Values are deliberately omitted here. They do not match the current local `.env` values inspected, but deployed credential rotation was not verified. The limited current-tree scan found credential-like literals in test fixtures and no private-key/GitHub-token matches; it is not a comprehensive history scan.

**Required before changing repository visibility:** Confirm old embedded credentials are retired wherever they were used, complete a dedicated history secret scan, choose a license, and document security reporting and the project's support/compatibility scope. State what location and vehicle data is retained and how owners can export/delete it.

## Further improvements before expanding the audience

- Publish a tested hardware matrix. The README describes Android 10/FYT 7862S/Perodua Axia; generic Android/head-unit compatibility has not been established. Cover permissions, Bluetooth adapters, boot behavior, and offline/reconnect recovery on each supported configuration.
- Add server connection testing, pairing expiry/retry guidance, and visible last-upload/backlog/error status. Preserve the existing offline collection and acknowledgement-based outbox behavior.
- Define retention, disk budgets, and supported workload. Telemetry ingestion appends to an in-memory array and writes the full JSON snapshot (`Server/server.js:1622-1634`); incremental dashboard polling does not remove that growing storage cost. Benchmark before selecting a database migration.
- Bound request-body buffering in `Dashboard/pages/api/[...path].ts:22-26`, review rate limits through the proxy, and run containers as a non-root user with tested volume ownership. These require targeted validation before an internet-facing release.
- Review Android backup exclusions: the application enables backup, while preferences contain device/master credentials. Decide explicitly what configuration and telemetry should be included.

## Acceptance gate for a novice beta

1. A tester on a clean supported machine follows one guide, obtains prebuilt artifacts, and reaches a working HTTPS dashboard without editing source or compiling Android/Node projects.
2. First login and password change work on a real non-loopback hostname. Errors identify missing configuration and unreachable services.
3. A normally sideloaded APK pairs exclusively with that tester's own instance. No master credential is copied to the head unit.
4. Real hardware retains readings through an internet outage and a restart, then drains the backlog after reconnect without losing or duplicating acknowledged records.
5. A release upgrade preserves server data and Android preferences; backup restoration and rollback are demonstrated, including persistence-failure recovery.
6. CI blocks publication when an APK, installer, image, metadata file, migration check, or onboarding smoke test is missing or fails.
7. Historical credentials are retired and publication/support/privacy documentation is present.

Recommended implementation order: deployment-specific URLs and scoped onboarding; complete HTTPS setup; signed/prebuilt release distribution and required CI; backup/recovery and hardware acceptance. Wider feature expansion can follow this release preparation.

## Review evidence

Temporary local evidence: `/tmp/obd-public-server-tests.log`, `/tmp/obd-public-dashboard-build.log`, `/tmp/obd-public-e2e.log`, `/tmp/obd-public-android-build.log`, `/tmp/obd-public-readiness-probe.json`, `/tmp/obd-public-server-audit.json`, and `/tmp/obd-public-dashboard-audit.json`. These paths may expire. Probe scripts used separate temporary data directories and random test credentials, and stopped their services afterward.
