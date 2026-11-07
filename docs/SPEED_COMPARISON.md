# GPS versus vehicle speed

The normal head-unit speed dial keeps its existing dimensions and OBD-first speed selection. Its title identifies **OBD SPEED** when using the ECU's OBD reading and **GPS SPEED** when GPS is the fallback. Vehicle speed here is the ECU-reported OBD value, not a reading of the instrument cluster.

On a sufficiently large dial card, a compact line below the unit displays:

```text
GPS 78.0 km/h · OBD−GPS +2.0 km/h
```

These example values are illustrative. A positive difference means the OBD value is higher; a negative difference means GPS is higher. Missing or stale values display a dash. A genuine stopped reading remains `0.0`. The controls drawer's GPS speed now uses the separate GPS reading as well, rather than echoing whichever source was chosen for the main dial.

## Data and freshness

The collector already reads both sources. The internal broadcast now supplies independent `obd_speed_kmh`, `obd_speed_at_elapsed_ms`, `gps_speed_kmh`, and `gps_speed_at_elapsed_ms` fields. The existing combined `speed`/`speed_source` remains available to other consumers. No new OBD queries, location subscriptions, polling frequency, networking, or database fields are added.

OBD capture time is recorded when the speed command returns. GPS time is the original fix's monotonic time. The main GPS fallback and comparison use the same current policy snapshot at publication. Storage's missing-GPS zero is never used as a sensor reading.

The comparison requires the active vehicle to match the sample. OBD values expire after 1.5 seconds; GPS speed expires after 3 seconds. A difference is shown only if both readings are valid and their capture times differ by at most 1.5 seconds. Negative, non-finite, future-dated, missing-timestamp, out-of-range OBD (>255 km/h), and implausible GPS (>400 km/h) values are rejected. Untrusted mock broadcasts and demo mode do not populate the comparison. Stopping the service clears it, and a one-second UI timer ages readings even if broadcasts stop.

When the adapter disconnects or speed is unavailable, the comparison has no OBD value, even when the main dial falls back to GPS. It therefore cannot compare GPS against itself and report a false zero difference.

## Layout and limits

The line overlays the existing bottom space without resizing the dial. It is restricted to speed dials with at least 320dp height and sufficient width, and hides for large fonts rather than crowding the gauge. Other metrics and display styles retain their layouts.

This is a live comparison, not a calibration result or a claim that either source is ground truth. The OBD speed command has whole-km/h resolution; one decimal place in the comparison does not increase it. GPS fix frequency depends on hardware, and refreshing the UI does not create a new GPS fix. Different sampling times can affect the difference during changing speed.

Offline unit and Android 10 emulator tests cover positive/negative/zero differences, independent expiry, stale GPS fixes, skew, GPS-only fallback, vehicle isolation, missing/invalid values, source labels, and layout. Physical-car validation remains a separate step.
