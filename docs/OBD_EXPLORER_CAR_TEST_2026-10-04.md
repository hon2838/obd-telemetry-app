# OBD Explorer car test — 2026-10-04

## Result and test boundary

The separate debug Explorer APK installed and connected successfully on a K706 Android 10 head unit using the paired OBDII Bluetooth Classic adapter and the default secure serial connection. It discovered 30 standard Mode 01 sensor PIDs; all 30 returned a matching service/PID data frame during one-shot sampling. No `NO DATA`, `ERROR`, or timeout replies appeared in the captured 237 requests.

Installation happened while the vehicle was moving, without opening Explorer or interrupting collection. Adapter tests began only after the user confirmed the vehicle was stopped. OBD speed was 0 km/h throughout Explorer's samples and live monitoring. The existing collector was paused for exclusive adapter access and restored afterward. It resumed in its original process as a foreground service; the normal app subsequently displayed live RPM, speed, coolant, throttle and voltage. Movement resumed after restoration; no further Explorer testing was performed.

This validates the current adapter/car pair, not every adapter, Android release, or vehicle. Receiving a valid frame does not establish sensor accuracy. In particular, calculated engine load reported 100% while stationary; that value requires separate plausibility investigation.

## Adapter and capabilities

- Self-reported banner: `ELM327 v1.5`; authenticity was not assessed.
- Adapter supply voltage: `13.8V`.
- Protocol: `AUTO,ISO 15765-4 (CAN 11/500)`; protocol number `A6`.
- Mode 01 masks: `41 00 BE 3F B8 13`, `41 20 80 04 20 01`, `41 40 4A DD 00 00`.
- Mode 09 mask: `49 00 54 00 00 00`, advertising VIN, calibration ID and calibration verification number.
- Identity checkbox remained off: no VIN, calibration or ECU identity reads were sent.
- Fuel level, oil temperature and ambient temperature were not advertised. Manufacturer-specific ABS, airbag, body and transmission discovery is outside this app's standard OBD scope.
- Headers were disabled: captured responses do not identify individual ECU addresses.

## First one-shot readings

Decoded rows use the app's implemented formulas; other rows preserve raw bytes without claiming a translated meaning.

| PID (hex) | Explorer label | First sample | Reply time (ms) |
| --- | --- | --- | --- |
| 01 | Monitor Status | Raw payload: `00 03 64 00` | 116 |
| 03 | Raw PID 03 | Raw payload: `02 00` | 154 |
| 04 | Engine Load | 100.00% | 145 |
| 05 | Coolant Temperature | 83 °C | 134 |
| 06 | Raw PID 06 | Raw payload: `7D` | 125 |
| 07 | Raw PID 07 | Raw payload: `82` | 114 |
| 0B | Raw PID 0B | Raw payload: `24` | 156 |
| 0C | Engine RPM | 733.50 RPM | 125 |
| 0D | Vehicle Speed | 0 km/h | 135 |
| 0E | Raw PID 0E | Raw payload: `8A` | 135 |
| 0F | Intake Air Temperature | 39 °C | 135 |
| 10 | MAF | 3.24 g/s | 115 |
| 11 | Throttle Position | 18.04% | 155 |
| 13 | Raw PID 13 | Raw payload: `03` | 125 |
| 14 | Raw PID 14 | Raw payload: `13 7E` | 146 |
| 15 | Raw PID 15 | Raw payload: `98 96` | 125 |
| 1C | Raw PID 1C | Raw payload: `06` | 136 |
| 1F | Engine Runtime | 544 seconds | 168 |
| 21 | Raw PID 21 | Raw payload: `00 00` | 115 |
| 2E | Raw PID 2E | Raw payload: `00` | 126 |
| 33 | Raw PID 33 | Raw payload: `65` | 147 |
| 42 | Module Voltage | 13.726 V | 116 |
| 45 | Raw PID 45 | Raw payload: `00` | 135 |
| 47 | Raw PID 47 | Raw payload: `D1` | 115 |
| 49 | Raw PID 49 | Raw payload: `28` | 156 |
| 4A | Raw PID 4A | Raw payload: `52` | 125 |
| 4C | Raw PID 4C | Raw payload: `1C` | 136 |
| 4D | Raw PID 4D | Raw payload: `00 00` | 115 |
| 4E | Raw PID 4E | Raw payload: `45 08` | 156 |
| 50 | Raw PID 50 | Raw payload: `00 00 00 00` | 105 |

## Live monitoring and faults

Live monitoring selected load, coolant, RPM, vehicle speed and throttle, with a 500 ms pause after each reply. The export retained 189 live sensor requests in addition to the initial one-shot samples. Display timestamps advanced across cycles; RPM and coolant changed, and speed stayed at zero. Across all 219 sensor requests, response time was 103–236 ms, median 134 ms. Five sensors at this pace refresh approximately every 3.2 seconds, including replies and inter-request pauses; the export does not record per-request wall-clock timestamps, so this is an estimate rather than a measured cycle interval.

Read-only fault requests returned `43 00` (stored), `47 00` (pending), and `4A 00` (permanent), with no codes present in these captured replies. Explorer retains raw fault responses and does not implement general fault-code translation. No clear-code, actuator, UDS, arbitrary CAN, or identity commands occurred in the exported command history.

## Stop, export and restoration

- Tapping Explorer's Stop / disconnect changed the status to `Disconnected — no commands running`, enabled Connect and disabled sensor queries.
- JSON export through the Android document picker succeeded in Downloads and was pulled to the laptop. The report contains all 237 exchanges, below the 300-entry retention limit.
- The normal telemetry app was restored to the foreground. Its collector was verified as `isForeground=true` and adapter initialization succeeded; subsequent UI readings confirmed data collection resumed.
- Explorer remains installed beside the original app and disconnected. The original app's installation, saved configuration and data were preserved.
- GPS showed `Waiting for GPS fix` in the restored collector. Explorer has no GPS support; this test does not resolve that separate issue.

Raw report on the laptop: `/home/hon2838/Storage/Documents/OBD Explorer Reports/2026-10-04-car-test.json`. Raw reports are kept outside the repository.

## Follow-up opportunities

Add labels and standard decoders for the additional advertised PIDs, a proper fault-code decoder, per-request timestamps and complete live-cycle timing. Explain the unusual 100% engine-load reply before relying on it in summaries. GPS acquisition in the normal collector remains a separate investigation. None of these changes were applied during the hardware test.
