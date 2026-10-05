# Estimated fuel economy in km/L

The Android telemetry readout and web dashboard show **Estimated fuel economy** in **km/L**, with **estimated fuel rate in L/h** alongside it. A larger km/L number means more distance per litre. A running engine at zero OBD speed displays `0.0 km/L`; L/h describes fuel use while stationary. Missing or unreliable inputs display `N/A`.

This is an instantaneous **petrol estimate**, not a measured injector flow or a trip average. It assumes a stoichiometric air–fuel ratio of 14.7 and petrol density of 750 g/L. It is not suitable for diesel, LPG or materially different fuel blends without a separate model or calibration. The UI labels the assumption explicitly.

## Inputs and calculation

The collector reads RPM, OBD speed, MAF airflow (Mode 01 PID 10) and fuel-system status (PID 03) within the same serialized cycle. The tested car returned `41 10 01 44`, which decodes to 3.24 g/s, and `41 03 02 00`, indicating closed-loop operation with no second active fuel system. The car did not advertise the direct engine fuel-rate PID 5E.

```text
estimated litres/hour = airflow(g/s) × 3600 / (14.7 × 750)
estimated km/L = OBD speed(km/h) / estimated litres/hour
```

For example, 30 g/s at 60 km/h produces approximately 9.80 L/hour internally and **6.125 km/L**. The display rounds to one decimal place; stored values retain precision. The prior stopped-car sample gives approximately 1.06 L/hour internally and 0 km/L because speed was zero. These examples are not new live measurements.

The estimate is suppressed when:

- The engine is stopped or RPM is unavailable.
- Airflow or OBD speed is missing, malformed, outside its range or non-finite; zero airflow is not treated as a free-fuel/infinite-economy reading.
- The primary fuel system is not in closed-loop oxygen-sensor feedback, or an active second system is not closed-loop. This excludes warm-up, enrichment, fuel-cut and fault states where fixed stoichiometry is unreliable.
- The collection cycle takes over five seconds, so old/mismatched inputs cannot become a new estimate.
- The adapter disconnects. Inputs are local to each cycle and are never carried over from an earlier cycle.

An unsupported airflow/status PID pauses those optional requests for five minutes while normal RPM, speed and throttle collection continues. Reconnection resets that backoff. The collector still targets its existing one-second cycle; the two extra requests and adapter latency can naturally make the cycle longer. It does not queue catch-up requests.

## Display and persistence

Android clears both fuel values after five seconds without a fresh telemetry update and when the collector stops. The dashboard shows **latest synced reading**, matching the existing approximately once-per-minute upload schedule. It clears both fuel figures when its connection fails or the sample exceeds the dashboard's 90-second reporting timeout. It is not a one-second cloud stream. Displays distinguish stale/disconnected data from unavailable or incomplete estimates; a null value alone does not establish that a sensor is unsupported or identify a particular fuel-control state.

Nullable telemetry fields are `mafGps` (g/s), `fuelSystemStatus` (primary raw status byte), `estimatedFuelRateLph` and `estimatedFuelEconomyKmL`. The Android Room database upgrades from version 9 to 10 without deleting queued/history records. Uploads carry those fields, including legitimate zero values. Server ingestion validates ranges and integer status, and JSON/SQLite storage retain the values across restart. Existing clients and old records without these fields remain compatible and display `N/A`.

The web server's SQLite database adds nullable columns in place. Deploy the server before installing the new collector so the new fields are retained on ingestion; an older server may acknowledge a batch while ignoring fields it does not yet normalize. Back up storage before an upgrade. No server deployment or car installation is part of this local implementation.

Trip summaries now integrate eligible fuel-rate samples over bounded capture-time intervals and expose coverage. The existing tank-level estimate remains a separate compatibility field. Manual refill statistics require explicitly recorded full-to-full cycles and stay separate from the MAF model. See [Trip and refill information](TRIP_FUEL_INFORMATION.md) for methods, quality limits and upgrade behavior. CSV exports append MAF, fuel status, estimated L/h and estimated km/L; older records export blanks for missing fields.

## Validation

Tests cover calculation, idle zero, invalid/missing inputs, engine-off state, closed-loop eligibility, stale inputs, OBD response parsing, preservation of a version-9 queue, actual upload serialization and server round-trips/restarts with JSON and SQLite. UI tests cover zero, unavailable and stale readings; dashboard browser tests also cover a lost connection. Builds are produced for standard Android and Android Auto; the new display is in the normal app activity, not the projected driving template.

The original instantaneous-estimate release passed 140 backend tests on Node.js 24, 60 standard Android JVM tests, 72 Android Auto JVM tests and four dashboard browser tests. Its standard and Android Auto debug APKs, Android Auto release APK and dashboard production build completed. The Android Auto manifest/lint gate passed with its documented legacy target finding. An existing HTTP cancellation test failed once during concurrent testing, then passed in isolation and the final complete suites. Standard lint still reports the existing target-29 Play-policy finding and two Bluetooth permission findings in unchanged adapter-list code; these were not hidden or broadened into this feature. Current follow-up validation is recorded in [Trip and refill information](TRIP_FUEL_INFORMATION.md).

The earlier Explorer hardware test confirmed the source PIDs on this car. The new collector/build still requires a parked on-car validation. Compare longer-term estimates with measured fill-up consumption before treating them as accurate fuel accounting.

Reference: [HEM Data's airflow-based fuel-economy method](https://hemdata.com/products/dawn/enews/fuel-economy-obd/).
