# Trip fuel and refill information

This update adds fuel information using existing collector data. It does not add OBD queries or change the fast polling cycle. The main Android activity and dashboard display estimated L/h beside instantaneous km/L; Android Auto continues to use its operational-status template.

## Trip estimates

The server integrates adjacent capture-time samples using the trapezoidal rule. Duplicate events and capture timestamps are reconciled without combining fields from different observations. Intervals over 30 seconds are excluded. This interval limit is separate from the collector's five-second within-cycle freshness requirement: the latter establishes eligibility of each individual fuel estimate.

Estimated litres include only intervals with eligible fuel rates, explicitly closed-loop primary fuel-system status and a running engine at both endpoints. Average estimated km/L uses integrated OBD speed and fuel over the same eligible intervals. It is never an arithmetic mean of instantaneous km/L, nor whole-trip distance divided by partially recorded fuel. Warm-up, enrichment, fuel-cut, disconnection and missing-sample periods can leave incomplete coverage. The totals describe covered intervals; they are not extrapolated to missing periods.

Idle duration requires valid OBD speed at or below 1 km/h and a running engine at both endpoints. Idle fuel is integrated only when eligible rate samples also exist. Engine-off or unknown-speed periods do not become idle time. Coverage is reported independently for fuel, paired economy, distance and idle-state observations.

Distance uses valid adjacent GPS fixes without crossing missing fixes or long gaps, rejecting implausible jumps. Where GPS distance is unavailable, valid adjacent OBD speeds can supply an explicitly labeled distance estimate. This does not reconstruct a GPS route or a lifetime odometer. Average speed is weighted by elapsed time rather than record count.

The efficiency leaderboard requires at least 80% capture-span coverage of paired economy intervals, at least 1 km of paired distance and at least one minute of trip span. This is a quality policy, not a claim of fuel-model calibration. The older tank-level-drop estimate remains explicitly labeled for compatibility and is excluded from this leaderboard.

## Manual refills

Fuel logs accept `fillState`: `full`, `partial`, or `unknown`. Omitted values and older records are `unknown`; they are not silently treated as full fills. The web form allows an explicit choice.

Gateway refills queued by the Android app still have an unspecified fill state and are treated as unknown. Record explicitly classified full/partial refills using the web form for measured cycles. The Android fuel-history screen consumes the server's cycle results rather than calculating economy between arbitrary adjacent fills. This update does not change the offline fuel outbox or Room schema.

Each vehicle has its own chronological refill sequence. An explicit full fill establishes a baseline. Partial fills accumulate until the next full fill; that completed cycle uses the odometer difference and the litres added after the baseline, including the ending full fill. Unknown fills or invalid/reset odometer intervals interrupt continuity. The next usable full fill establishes a new baseline. Fleet statistics combine valid cycles after calculating them separately for each vehicle.

Existing logs remain stored and visible, but unclassified historical fills do not produce trusted consumption cycles. Statistics and the UI expose valid-cycle and unknown-fill counts. A vehicle without a complete cycle has unavailable measured economy rather than a useful measured zero. Manual refill measurements and modeled trip estimates remain distinct.

## Diagnostics correctness

Fault codes accept their standard hexadecimal characters, including codes such as `P0A80`. Missing, malformed, unsupported or failed diagnostic reads must not imply a successful no-fault result. The diagnostics view reports the most recent read outcome and retains previous successful readings as historical information. Existing durable read/clear commands and vehicle authorization remain in use.

## Compatibility and remaining work

No telemetry database migration is required for these displays or trip calculations. Deploy the updated server and dashboard together for the new summary fields; the dashboard handles missing fields from older responses. Refill fields are additive to the existing JSON logs. The Android display update is version 1.3.1 (code 5), using the existing version-10 Room schema.

Capability profiles, detailed queue/field-age metadata, new intake/trim/pedal/readiness sensors and bounded SQLite history queries remain separate follow-up work. SQLite currently still loads the entire telemetry history into memory; this update does not claim to solve large-history memory scaling. No installation, live car testing or production deployment is implied by local validation.

## Validation

Regression checks cover partial fuel coverage, duplicate/backfilled samples, invalid or missing inputs, idling and engine-off boundaries, full/partial/unknown refill cycles, multiple vehicles, diagnostics failures, persistence across restart, export zeros/blanks and display freshness. Detailed interval and compatibility contracts are in [Trip calculations](TRIP_CALCULATIONS.md).
