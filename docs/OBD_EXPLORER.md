# OBD Explorer: separate adapter and vehicle test app

OBD Explorer is a standalone Android app, package `com.example.obdprobe`, built from `AndroidApp/probe`. It installs beside the standard telemetry and Android Auto apps. It does not inherit their configuration, pair with the cloud, collect GPS, start a background service, or request internet access.

It supports paired **Bluetooth Classic ELM327 / SPP adapters**. BLE-only, Wi-Fi and USB adapters are outside this version's scope. This matches the Classic adapter transport used by the existing telemetry app.

## What it can inspect

- Reported adapter banner, adapter supply voltage and discovered vehicle protocol. A banner alone does not establish an adapter's authenticity.
- Standard Mode 01 supported-PID masks, following advertised continuation blocks up to the last valid block. Multiple ECU responses are combined into a capability set.
- A one-time sample of every advertised sensor. RPM, speed, throttle, load, coolant, intake/ambient/oil temperature, MAF, runtime, fuel level and module voltage have decoded values. Other supported PIDs retain raw hex.
- Selected live readings, limited to 12 sensors, with a selectable 250 ms–2 s delay **after each reply**. Actual refresh time also depends on the adapter and number of selected sensors.
- Raw stored, pending and permanent fault-code replies (Modes 03, 07 and 0A). Fault-code translation is not implemented; raw replies are retained.
- Mode 09 capabilities. VIN, calibration ID, verification number and ECU-name requests run only if the vehicle advertises them and the identity checkbox is selected. Multiline identity replies remain raw.
- A JSON export with up to the last 300 requests, responses and response timings. Reports are held in memory until export; restarting the app or recreating its activity discards them. Each saved response is capped at 4,096 characters. Raw replies may contain VIN if identity queries were enabled. Export is user initiated through Android's file picker; there is no automatic upload.

The capability set is what the vehicle advertises through standard OBD services. A listed PID can still return `NO DATA`. Generic OBD cannot discover every manufacturer-specific feature, such as ABS, airbags, body modules or proprietary transmission data. No arbitrary CAN, UDS or actuator requests are included. With headers disabled, responses are retained separately but are not attributed to individual ECU addresses.

## On-car use

1. Install the separate APK. Use while parked, with ignition on; some readings need the engine running.
2. Disconnect any other app using the adapter first. Many Classic adapters support one client at a time. Explorer never stops the existing collector automatically.
3. Pair the adapter in Android Bluetooth settings. Open Explorer, tap **Refresh paired adapters**, and allow **Nearby devices** when Android requests it.
4. Select the adapter and tap **Connect selected adapter**. Try the compatible connection option if secure connection fails.
5. Tap **Discover supported readings**, then **Sample all discovered readings once**. If there is no valid support map, sampling can try the common read-only sensors instead; it does not claim these are advertised.
6. Select up to 12 sensors for live monitoring. **Stop / disconnect** closes the serial link and cancels the operation. Leaving the app also disconnects it.
7. Stop before exporting the report. Cancelled or timed-out requests remain errors; the app does not convert them into zero values.

## Build and validation

Use JDK 17 and Android SDK 36:

```sh
make apk-probe
make test-probe
```

Output: `AndroidApp/probe/build/outputs/apk/debug/probe-debug.apk`. Minimum Android version is 8.0 (API 26), target API 36. The APK is signed with the local debug key and is a testing build.

The transport permits only a fixed set of adapter setup/status commands, standard Mode 01 sensor requests, the specified Mode 09 reads, and fault-code reads. The policy rejects clear-code Mode 04, actuator Mode 08, UDS requests, arbitrary CAN commands and command separators. Serial requests are bounded by time and reply size; a missing prompt or overflow closes the connection to prevent stale replies being read as a later response.

Local validation passed all 35 probe tests and the existing 110 Android JVM tests; the debug APK and lint completed successfully with no lint errors. Local validation covers capability chaining, multi-ECU replies, malformed/truncated/negative replies, numeric sensor decoding, command restrictions and failed-request reporting. Four adversarial parser regressions failed before the correction and passed afterward. On 2026-10-04, installation, package metadata, Bluetooth permissions and launcher resolution were verified on the K706 Android 10 head unit. Explorer was not launched while the vehicle was moving; the existing telemetry collector remained running in its original process. After the user confirmed the vehicle was stopped, Explorer connected successfully, sampled all 30 advertised sensor PIDs, refreshed five live sensors, captured stored/pending/permanent fault replies, disconnected on Stop, and exported 237 exchanges. The original collector was restored and live readings resumed. See [the car-test report](OBD_EXPLORER_CAR_TEST_2026-10-04.md) for observed readings, timing and limits. This validates the tested adapter/car pair; broader compatibility and sensor accuracy remain unverified.

Reference: [ELM327 manufacturer datasheet](https://elmelectronics.com/wp-content/uploads/2020/05/ELM327DSL.pdf) for adapter commands, protocol discovery, supported-PID queries and multiline replies.
