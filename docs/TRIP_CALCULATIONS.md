# Trip estimates and recorded coverage

Trip summaries use telemetry **capture timestamps**, independent of upload order. The server groups vehicles before applying the existing five-minute inactivity split. Calculation endpoints are sorted and deduplicated per vehicle: duplicate event IDs and capture timestamps use the highest ingest sequence, or the last supplied record when sequences tie. Fields from separate records are never stitched together. The pure helper rejects mixed-vehicle inputs.

## Eligible intervals

Only consecutive captures **at most 30 seconds apart** contribute to integration. Longer gaps and missing values are excluded; they are never bridged or filled with zero. The 30-second integration bound is a conservative reporting policy, separate from the Android collector's five-second limit for obtaining fresh inputs **within one sample**. It does not prove that the physical values varied linearly between captures.

`quality` exposes capture-span duration, the integration bound, long-gap count and largest gap, usable endpoint count, discarded duplicates, and covered seconds/ratios for fuel, paired economy, distance, speed and idle classification. Coverage is covered time divided by first-to-last capture span; single-point trips have unavailable ratios. Idle-fuel coverage instead uses observed idle duration as its denominator and is unavailable when no idle interval was observed. Capture span is not proof of ignition time: it includes gaps and any recorded stopped-engine intervals.

## Estimated fuel and economy

`estimatedFuelUsedLitres` is the sum of trapezoidal integrals of `estimatedFuelRateLph`: mean endpoint L/hour multiplied by interval hours. Both endpoints require finite nonnegative rates, known RPM above zero and primary `fuelSystemStatus === 2` (closed loop). Missing RPM/status, known engine-off states and explicit non-closed-loop status exclude the interval. The collector already suppresses unreliable airflow/secondary-fuel-system/cycle inputs; the summary uses stored rates and does not invent them from tank levels. The model assumes petrol at 14.7 stoichiometric air/fuel ratio and 750 g/L density, as described in [fuel economy](FUEL_ECONOMY.md).

`estimatedFuelEconomyKmL` divides **OBD-speed distance over the same eligible intervals** by estimated litres over those intervals. It never averages instantaneous km/L and never divides an entire trip distance by partially covered fuel. `economyDistanceKm`, `economyFuelUsedLitres` and separate economy coverage make this denominator visible. Missing OBD speed excludes an interval from economy even when a fuel integral is available. Known zero speed with positive fuel produces legitimate zero km/L. Zero integrated litres produce unavailable economy, never infinity.

The efficiency leaderboard requires at least one kilometre of paired distance, a capture span of at least 60 seconds, positive integrated fuel and at least **80% paired coverage**. This policy avoids ranking short or poorly covered estimates; it does not calibrate them into measured fuel accounting. The summary reports the threshold and eligibility explicitly.

## Idling

`idleSeconds` includes only bounded adjacent intervals with both OBD speeds at most **1 km/h** and both RPM values above zero. Missing OBD speed/RPM is unknown; stopped engines and intervals with on/off or idle/moving endpoint transitions are excluded from idle duration. `estimatedIdleFuelLitres` integrates the eligible rate over those idle intervals. Observed idle with no usable fuel rates has unavailable fuel, while fully observed absence of idle can legitimately report zero idle seconds and zero idle fuel. Partial idle fuel is a covered amount with its own coverage, never a whole-trip total.

## Distance and average speed

`distanceKm` sums bounded adjacent GPS segments, with trapezoidal **OBD-speed distance** as an interval fallback. Missing/invalid fixes are not bridged. Coordinates on the equator or prime meridian are valid; `(0,0)` is treated as the collector's unavailable-location sentinel. GPS jumps implying more than the telemetry speed limit of 500 km/h are rejected and counted. This broad plausibility bound does not eliminate small GPS jitter, inaccurate fixes, stale coordinates or corner-cutting.

`distanceSource` identifies GPS, OBD speed, mixed GPS/OBD fallback or unavailable data. Distance coverage counts accepted distance intervals, and separate GPS/fallback seconds expose provenance. GPS presence can support distance without OBD speed; this distance is deliberately distinct from the OBD distance used in fuel economy.

`avgSpeed` is time weighted over bounded intervals with valid speeds at both endpoints. It prefers OBD speed and can use GPS speed only when that sample also has a valid GPS fix. The GPS-fix guard is an availability check, not proof of location freshness. No eligible interval means unavailable distance/average speed rather than a fabricated zero.

## Compatibility and display

Existing `fuelUsedPercent` and `fuelEfficiencyKmL` retain their tank-level meanings. The old efficiency denominator retains its original unbounded GPS polyline for compatibility, so it can differ from the new covered `distanceKm`. `fuelEfficiencySource` and `legacyTankEstimate` explicitly label its endpoint tank-drop method, configured/default tank capacity and unvalidated reliability. Legacy estimates are excluded from efficiency rankings.

The trip page displays estimated covered litres, paired km/L, observed idling, coverage and distance provenance. Older servers without new fields can display tank economy with the label **Legacy tank-level estimate**. Missing new estimates remain unavailable instead of silently falling back to tank figures. Trend/detail charts preserve missing values as gaps. These summaries are approximate, uncalibrated estimates; deployment and parked/road hardware checks are separate validation steps.
