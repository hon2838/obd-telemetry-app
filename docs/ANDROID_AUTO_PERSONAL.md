# Personal Android Auto cockpit experiment

The `androidautopersonal` flavor projects the six-card cockpit through the host's drawing Surface instead of updating a template grid. Its separate package is `com.example.obdapp.androidauto.personal`, labeled **OBD Cockpit Personal**. The standard head-unit app and the normal **OBD Connect** Android Auto app keep their own packages.

This is a private development experiment. It declares the navigation category because the Car App Library exposes the drawing Surface through navigation templates. It provides **no navigation, routes, or turn guidance**. This declaration does not establish category eligibility, Google Play approval, or permission to ship a gauge dashboard as a navigation app. No Android Auto host patch, installer-origin spoof, or blanket platform-rule bypass is included.

## What it displays

- Speed and RPM dials; throttle, engine load, coolant, and intake temperature cards.
- GPS speed and OBD minus GPS difference, using independent sensor timestamps. GPS fallback never compares GPS against itself.
- Instantaneous fuel economy in km/L, estimated fuel use in L/h, and current-trip fuel economy with coverage and paused state.
- A connected, waiting, or stopped indicator. Unavailable or expired readings are cleared.

The renderer redraws every 500 ms while the car screen is started. This reads the existing collector snapshot; it does not force the adapter, GPS provider, or each PID to produce a new measurement every 500 ms. Host display scheduling may reduce the visible frame rate. All setup, adapter pairing, vehicle selection, and diagnostics remain on the phone. There are no cockpit editing gestures or car-screen diagnostic commands.

The existing widgets adapt to host dimensions, density, and font size. Compact hosts can hide supplemental fuel and speed-comparison rows to preserve the primary gauges. The car host retains its system controls and overlays; the app draws only inside the intersected visible and stable areas.

## Build

Use JDK 17 and Android SDK 36:

```sh
make apk-androidauto-personal
cd AndroidApp
./gradlew :app:testStandardDebugUnitTest :app:testAndroidautoDebugUnitTest \
  :app:testAndroidautopersonalDebugUnitTest :app:assembleAndroidautoRelease \
  :app:assembleAndroidautopersonalRelease :app:lintAndroidautoDebug \
  :app:lintAndroidautopersonalDebug --no-daemon
python3 scripts/check_androidauto_validation.py
```

Debug APK: `AndroidApp/app/build/outputs/apk/androidautopersonal/debug/app-androidautopersonal-debug.apk`. Release APKs remain unsigned until signing is configured. The existing server APK bundle target still packages the standard head-unit app.

## Phone and host setup

1. Install this separate package on the phone and configure its vehicle, API pairing, permissions, and Bluetooth adapter while parked. Settings and credentials are not copied from the other packages.
2. Start collection from the visible phone activity. Use one collector per adapter: stop the other phone/head-unit collector before connecting this package to the same adapter.
3. For a development check, follow Google's [Desktop Head Unit instructions](https://developer.android.com/training/cars/testing/dhu). A compatible phone running Android Auto is needed; this work's offline Android emulator tests do not substitute for a phone/DHU session.
4. For a real vehicle, Google's [testing guidance](https://developer.android.com/training/cars/testing) requires a trusted installation source for Car App Library apps. It identifies Internal App Sharing and an internal test track as test distribution routes. Android Auto's **Unknown sources** option does not apply to Car App Library apps. Personal use and ordinary sideloading alone do not guarantee discovery or acceptance by the host. No Play distribution was performed for this change.
5. Confirm discovery and Surface delivery, reconnect/disconnect, host overlays, display resizing, foreground collection, screen sleep, stale readings, and phone process death before treating projection as working on a particular phone/car combination. If the host declines the Surface, the screen displays a failure message; it cannot force the host to accept the app.

## Implementation boundaries

`PersonalCarAppService` reuses the normal service's host validation and starts `PersonalCockpitScreen`. Debug builds accept development hosts; release builds retain package-and-certificate validation. Surface permissions and the navigation service category are confined to this flavor. Both phone flavors target SDK 36 and exclude boot collection and background location.

The screen retains one `NavigationTemplate` while sensor data changes, avoiding template task-quota consumption on each reading. Its 500 ms job and Surface callback are detached when stopped; received Surface references are released. Rendering uses host density and bounded View state, with no added database, adapter, or upload work.

Engine and instantaneous-fuel values expire after five seconds. Speed uses the existing independent GPS/OBD freshness policy and suppresses differences for skewed samples. Trip averages retain their original timestamp through brief gaps, display paused when appropriate, expire after five minutes, and clear on vehicle change. A snapshot without original source timestamps cannot refresh an older measurement.

## Validation limits

Local checks cover the shared collector snapshot, normal Android Auto grid refresh rules, fuel expiry, vehicle isolation, personal renderer, template stability, lifecycle cancellation, Surface release, density changes, and viewport clipping. Emulator-only instrumented tests draw the real Android Views to bitmaps using synthetic input with network disabled and collection stopped. Those images prove the renderer works on Android; they are **not screenshots of an actual Android Auto host session**.

Real phone/DHU and car-host acceptance remain pending. Existing production credentials still use the app's shared preference storage. Android lint retains the documented legacy target-SDK-29 finding from the standard head-unit default; the manifest/lint gate rejects other errors in both phone flavors.

On 2026-11-09, version 1.3.11 passed 217 standard, 235 normal Android Auto, and 248 personal Android Auto JVM tests (700 runs across flavors, including shared tests), plus four offline API-29 emulator tests. Standard debug, both phone debug APKs, and both unsigned phone release APKs built successfully. The two phone lint reports and Debug/Release manifests passed the validation gate with the documented legacy exception. The inspected emulator renders include 1280×720 at 160 and 240 dpi, 800×480 at 160 dpi, stale data behind a reduced viewport, and GPS fallback. No physical phone or car host was connected for these checks.

References: [drawing Surface contract](https://developer.android.com/training/cars/apps/library/draw-maps), [navigation app guidance](https://developer.android.com/training/cars/apps/navigation), [SurfaceCallback ownership](https://developer.android.com/reference/androidx/car/app/SurfaceCallback).
