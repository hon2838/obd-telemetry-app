# Dashboard telemetry workspace

The dashboard opens on **Readings** (`/`). **Overview** (`/overview`) provides trip totals and available maintenance information. The shared header includes a vehicle picker, direct links to Readings, Overview and Trips, and grouped access to the remaining pages. A drawer provides navigation on smaller screens.

## Interface and behavior

- Flat dark surfaces, restrained teal accents, shared summary cards and consistent form controls replace the previous effects-heavy presentation.
- Readings places essential metrics before synchronized charts and the location preview. Secondary signals are expandable. The primary cards use six columns on large screens, three on tablets and two on phones.
- Data status distinguishes recent measurements, old or invalid timestamps, initial setup and server failures. It does not infer adapter connectivity or the number of records waiting to upload. The Android collector's offline recording and later upload behavior is unchanged.
- All Vehicles shows fleet summaries or vehicle selection rather than mixing one vehicle's readings into a fleet display. A new single-vehicle installation selects its vehicle automatically while preserving an explicitly saved All Vehicles preference.
- Trips includes local-date filters, pagination and a shared detail dialog. Vehicle changes clear obsolete details and abort pending requests. Server-qualified efficiency rankings, missing estimates, valid zero values and legacy estimate labels are preserved.
- Diagnostic read and clear commands require an explicit vehicle. Clear confirmation describes uncertain delivery; failed scans retain historical results with an appropriate label.
- Refuel forms retain finite-value and odometer validation. Pairing explains that device authorization alone does not establish a working adapter connection or successful upload.

## Accessibility and validation

Navigation supports keyboard selection and Escape. Dialogs have accessible labels, keyboard focus containment, focus restoration and scroll locking. Small-screen checks cover 320, 350 and 390 pixel widths, plus tablet and desktop layouts. Chart tooltips remain usable within their containers.

Run from `Dashboard/` with the project's supported Node.js version:

- `npm run lint` for TypeScript validation.
- `npm run build` for the production build.
- `node scripts/check-auth-timeout.cjs` for authentication gateway timeout regressions.
- `npm test` for the Playwright suite, with the credentials and backend environment described by `tests/e2e-auth.ts` and `playwright.config.ts`.

The browser tests require a disposable backend account. They exercise real authentication against that backend and use controlled responses for telemetry and command scenarios. Additional coverage is in `tests/workspace-ui.spec.ts` and `tests/integration-ui-review.spec.ts`; existing authentication, fuel, diagnostic and trip regression checks are retained.

This change is confined to the web dashboard. It does not change backend contracts, Android collection or deployment configuration.
