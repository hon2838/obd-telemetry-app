# Experimental Axia 4AT gear display

**Retired in Android 1.3.10.** The estimated-gear row and setting have been replaced by [trip-average fuel economy](TRIP_FUEL_ECONOMY.md). The description below is historical; its classes and test commands apply to version 1.3.9 and earlier.

In the head-unit app's settings, enable **Estimated gears — Axia 4-speed automatic** for the selected vehicle. It defaults off, and each vehicle has its own setting. The number appears below the throttle bar, above current fuel economy, when the card has enough space. Small cards and large accessibility fonts hide the supplemental gear row.

This is an experimental **RPM / OBD speed estimate**, not an ECU-reported gear. The initial bands are observations from this vehicle's telemetry, without a labelled transmission reference. They have not been validated against actual selected gears. They should not be treated as factory ratios or enabled for a different transmission, including a D-CVT.

The initial RPM-per-km/h centres for gears 1–4 are `124, 70, 46, 30`. The estimator requires three matching samples spanning at least one second, within 7.5% of a band. Minimum speeds are respectively `12, 18, 30, 50 km/h`. It rejects missing readings, RPM outside 1000–5000, speed outside 12–160 km/h, and throttle above 40%. A ratio jump above 8% restarts confirmation.

A dash means uncertain. Stops, shifts, converter slip, stale or disconnected readings, GPS speed, demo data, and samples from another vehicle clear the estimate. RPM and unsigned speed cannot identify **P/R/N or travel direction**. This feature assumes ordinary forward driving and provides no selector-position indication.

The calculation uses existing telemetry broadcasts and adds no OBD queries, server requests, storage fields, or transmission commands. `vehicle_id` is included in the internal telemetry broadcast to bind the estimate to the selected vehicle.

## Offline validation

`AxiaGearEstimateTest` tests the calculation; `GearEstimateUiTest` checks the activity's data gates and layout. Run both standard and Android Auto unit suites:

```sh
cd AndroidApp
./gradlew :app:testStandardDebugUnitTest :app:testAndroidautoDebugUnitTest
```

`GearEstimateOfflineTest` is an emulator-only integration suite. It disables collector autostart, uses a dummy token and loopback API, and asserts that no network is active. On an Android 10 emulator configured at 1280×720 and density 160, with Wi-Fi and mobile data disabled:

```sh
ANDROID_SERIAL=emulator-5554 ./gradlew :app:connectedStandardDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.example.obdapp.GearEstimateOfflineTest
```

The suite checks four simulated gears, uncertain shifts, stale readings, GPS fallback, vehicle separation, untrusted simulation, profile changes, and constrained layouts. These checks validate implementation and rendering; they do not establish real-world gear accuracy. Car deployment and comparison with a transmission reference remain separate validation steps.
