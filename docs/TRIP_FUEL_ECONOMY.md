# Current-trip fuel economy

Android 1.3.10 replaces the optional virtual-gear row with **TRIP AVG**, in **km/L**. It is enabled automatically on sufficiently large throttle/bar cards. Fuel use in L/h stays above it, and instantaneous fuel economy stays below. Smaller cards and large accessibility fonts hide supplemental rows to preserve the main readings. No gear-profile setting is required.

The number is an estimate from existing OBD readings, not a fuel-flow-meter or tank-refill measurement. `Est. · 85% sampled` means 85% of the observed trip duration has matching usable speed and fuel data. It does not claim the missing 15% used no fuel. `Paused` retains the recorded average during a short collector/adapter interruption; a dash means no usable average is available.

## Calculation

The collector integrates each adjacent pair of valid OBD speeds and estimated fuel rates using elapsed time:

```
distanceKm += (speedBefore + speedAfter) / 2 × intervalHours
fuelLitres += (rateBefore + rateAfter) / 2 × intervalHours
tripKmPerLitre = distanceKm / fuelLitres
```

Both totals use the **same intervals**. Instantaneous km/L readings are never averaged. Valid idling burns fuel while adding zero distance, so it lowers the trip average. Zero distance with positive fuel gives a real 0.0 km/L; zero estimated fuel gives a dash rather than infinity.

The existing petrol MAF estimate remains restricted to fresh closed-loop operation. Warm-up, enrichment, fuel cut-off, missing/invalid fuel, GPS-only speed and other unsupported samples do not gain invented fuel values. Neither distance nor fuel enters the economy totals unless both endpoints have valid paired inputs. Unknown intervals still count in the coverage denominator. The result can therefore be a sampled estimate of part of a trip, particularly during warm-up or coasting.

Intervals longer than 30 seconds and transitions between adapter connection generations are excluded from integration. These rules match the paired OBD/fuel calculation in `Server/trip_calculations.js`. The app adds no OBD polls, GPS dependence, cloud requests, telemetry-table scans, API fields or database migrations.

## Trip lifecycle and persistence

- A telemetry gap **strictly greater than five minutes** starts a new trip, using the same gap threshold as server drive segmentation. Short stops remain in the trip. Ignition-off alone is not a separate trip boundary. GPS-only collector samples can keep a trip open while lowering fuel-data coverage; if collection stops, the gap is measured on its return.
- Totals belong to the collector, so closing the dashboard or opening navigation does not reset them. Each vehicle has separate totals. Switching vehicles checkpoints the old one; returning within the trip gap can resume it, with the unobserved interval marked as uncovered.
- A compact checkpoint is queued every ten seconds, at a vehicle switch, and on orderly service destruction. Disk writes are asynchronous; a sudden process/device termination can lose recent readings and an unflushed checkpoint. This is not a zero-loss accounting ledger. At most 32 vehicle checkpoints are retained; there is no growing in-memory telemetry history.
- A same-boot process restart can resume recent totals. The previous integration endpoint is deliberately not persisted, so downtime is never interpolated. A reboot, expired checkpoint, malformed checkpoint, or unavailable boot identity starts a fresh trip. Android 6/API23 has no reliable platform boot-count API, so each collector restart starts a new trip there.
- Monotonic elapsed time defines intervals and gaps; wall-clock corrections do not add distance, fuel or false intervals. New installations start collecting their own totals; existing cloud trip history is not downloaded or retroactively replayed.
- Trip summaries use trusted current-vehicle broadcasts. Demo and mismatched-vehicle telemetry cannot populate this row. Monotonic summary age and ordering reject expired/future summaries and prevent delayed packets rolling back newer totals; wall-clock corrections do not clear the cumulative display. A previously recorded average can show as paused for up to five minutes, after which it clears while waiting for a new trip.

## Validation

`TripFuelAccumulatorTest` covers paired integration, idle, missing data, 30-second bounds, strict trip gaps, connection generations, restarts, ordering and clock changes. `TripFuelRepositoryTest` covers checkpoint cadence, final flush, vehicle isolation, boot/expiry/corruption handling and storage bounds. `TripFuelUiTest` covers trusted scope, paused/expired summaries, unavailable values and layout.

```sh
cd AndroidApp
./gradlew :app:testStandardDebugUnitTest :app:testAndroidautoDebugUnitTest \
  :app:assembleStandardDebug :app:assembleStandardDebugAndroidTest
```

`TripFuelOfflineTest` exercises the real Activity on an emulator only, with the collector stopped, no active network and a dummy loopback API. It retains the existing instantaneous-fuel and GPS comparison regressions. Configure the emulator to 1280×720, density160, with Wi-Fi and mobile data disabled:

```sh
ANDROID_SERIAL=emulator-5554 ./gradlew :app:connectedStandardDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.example.obdapp.TripFuelOfflineTest
```

Emulator samples are synthetic. They establish calculation and display behavior, not physical fuel-measurement accuracy. Car installation and road validation are separate steps.

Validated locally: **213 standard JVM tests, 228 Android Auto JVM tests, and seven offline emulator tests passed**, with no failures or skips. The standard app and instrumentation APKs built, and the 1.3.10/code14 signing identity matched the existing app. The 1280×720 emulator preview was inspected. No car or production server was accessed for this feature change.
