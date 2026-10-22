// Capture-time integration only: upload/ingest time never defines a trip interval.
const MAX_INTERVAL_MS = 30_000;
const MIN_LEADERBOARD_COVERAGE = 0.8;
const IDLE_SPEED_KMH = 1;
const numeric = (value, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const knownSpeed = record => numeric(record.speed, 500) ? record.speed : validGps(record) && numeric(record.gpsSpeed, 500) ? record.gpsSpeed : null;
const knownObdSpeed = record => numeric(record.speed, 500) ? record.speed : null;
const engineRunning = record => numeric(record.rpm, 20_000) && record.rpm > 0;
const fuelRate = record => engineRunning(record) && record.fuelSystemStatus === 2 && numeric(record.estimatedFuelRateLph, 1000) ? record.estimatedFuelRateLph : null;
const validGps = record => typeof record.latitude === 'number' && Number.isFinite(record.latitude) && Math.abs(record.latitude) <= 90 &&
  typeof record.longitude === 'number' && Number.isFinite(record.longitude) && Math.abs(record.longitude) <= 180 &&
  !(record.latitude === 0 && record.longitude === 0);
const rounded = (value, digits = 4) => value === null ? null : Number(value.toFixed(digits));

function gpsDistance(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// One endpoint per vehicle/capture time. Prefer the latest ingested record,
// without stitching missing fields from separate observations into a new sample.
function normalizeTripRecords(records) {
  const events = new Map();
  const captures = new Map();
  let invalidTimestampCount = 0;
  let duplicateCount = 0;
  const latest = (old, next) => !old || (next.ingestSeq || 0) >= (old.ingestSeq || 0) ? next : old;
  for (const record of records) {
    if (!numeric(record.timestamp)) { invalidTimestampCount++; continue; }
    const vehicle = record.vehicleId || 'default';
    const key = record.eventId ? `${vehicle}\u0000${record.eventId}` : Symbol();
    if (events.has(key)) duplicateCount++;
    events.set(key, latest(events.get(key), record));
  }
  for (const record of events.values()) {
    const key = `${record.vehicleId || 'default'}\u0000${record.timestamp}`;
    if (captures.has(key)) duplicateCount++;
    captures.set(key, latest(captures.get(key), record));
  }
  return { points: [...captures.values()].sort((a, b) => a.timestamp - b.timestamp), duplicateCount, invalidTimestampCount };
}

function calculateTripMetrics(records) {
  const normalized = normalizeTripRecords(records);
  const points = normalized.points;
  if (new Set(points.map(record => record.vehicleId || 'default')).size > 1) {
    throw new TypeError('Trip metrics require records from one vehicle');
  }
  const durationMs = points.length > 1 ? points.at(-1).timestamp - points[0].timestamp : 0;
  let coveredMs = 0, gapCount = 0, maxGapMs = 0;
  let speedMs = 0, speedIntegral = 0, fuelMs = 0, litres = 0;
  let economyMs = 0, economyLitres = 0, economyDistanceKm = 0;
  let distanceMs = 0, distanceKm = 0, gpsMs = 0, obdDistanceMs = 0, rejectedGpsIntervals = 0;
  let idleStateMs = 0, idleMs = 0, idleFuelMs = 0, idleLitres = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if ((a.vehicleId || 'default') !== (b.vehicleId || 'default')) continue;
    const dt = b.timestamp - a.timestamp;
    maxGapMs = Math.max(maxGapMs, dt);
    if (dt <= 0 || dt > MAX_INTERVAL_MS) { if (dt > MAX_INTERVAL_MS) gapCount++; continue; }
    coveredMs += dt;
    const hours = dt / 3_600_000;
    const sa = knownSpeed(a), sb = knownSpeed(b);
    if (sa !== null && sb !== null) { speedMs += dt; speedIntegral += (sa + sb) / 2 * dt; }
    const oa = knownObdSpeed(a), ob = knownObdSpeed(b);
    const obdDistance = oa !== null && ob !== null ? (oa + ob) / 2 * hours : null;
    let gpsKm = null;
    if (validGps(a) && validGps(b)) {
      const candidate = gpsDistance(a, b);
      // Discard impossible jumps above the ingest speed limit; do not bridge
      // missing GPS samples. A valid zero-length GPS interval stays zero.
      if (candidate / hours <= 500) gpsKm = candidate;
      else rejectedGpsIntervals++;
    }
    if (gpsKm !== null) { distanceKm += gpsKm; gpsMs += dt; distanceMs += dt; }
    else if (obdDistance !== null) { distanceKm += obdDistance; obdDistanceMs += dt; distanceMs += dt; }
    const fa = fuelRate(a), fb = fuelRate(b);
    const intervalLitres = fa !== null && fb !== null ? (fa + fb) / 2 * hours : null;
    if (intervalLitres !== null) {
      fuelMs += dt; litres += intervalLitres;
      if (obdDistance !== null) { economyMs += dt; economyLitres += intervalLitres; economyDistanceKm += obdDistance; }
    }
    if (oa !== null && ob !== null && numeric(a.rpm, 20_000) && numeric(b.rpm, 20_000)) {
      idleStateMs += dt;
      if (engineRunning(a) && engineRunning(b) && oa <= IDLE_SPEED_KMH && ob <= IDLE_SPEED_KMH) {
        idleMs += dt;
        if (intervalLitres !== null) { idleFuelMs += dt; idleLitres += intervalLitres; }
      }
    }
  }
  const ratio = ms => durationMs > 0 ? rounded(ms / durationMs) : null;
  const economy = economyMs > 0 && economyLitres > 0 ? economyDistanceKm / economyLitres : null;
  const quality = {
    durationSeconds: durationMs / 1000, maxIntervalSeconds: MAX_INTERVAL_MS / 1000,
    coveredSeconds: coveredMs / 1000, coverageRatio: ratio(coveredMs),
    gapCount, maxGapSeconds: maxGapMs / 1000,
    usablePointCount: points.length, duplicateCount: normalized.duplicateCount, invalidTimestampCount: normalized.invalidTimestampCount,
    distanceCoveredSeconds: distanceMs / 1000, distanceCoverageRatio: ratio(distanceMs),
    speedCoveredSeconds: speedMs / 1000, speedCoverageRatio: ratio(speedMs),
    fuelCoveredSeconds: fuelMs / 1000, fuelCoverageRatio: ratio(fuelMs),
    economyCoveredSeconds: economyMs / 1000, economyCoverageRatio: ratio(economyMs),
    idleStateCoveredSeconds: idleStateMs / 1000, idleStateCoverageRatio: ratio(idleStateMs),
    idleFuelCoveredSeconds: idleFuelMs / 1000, idleFuelCoverageRatio: idleMs > 0 ? rounded(idleFuelMs / idleMs) : null,
    gpsDistanceCoveredSeconds: gpsMs / 1000, obdFallbackCoveredSeconds: obdDistanceMs / 1000,
    rejectedGpsIntervals,
    efficiencyLeaderboardEligible: economy !== null && economyDistanceKm >= 1 && durationMs >= 60_000 && economyMs / durationMs >= MIN_LEADERBOARD_COVERAGE,
    minimumLeaderboardCoverageRatio: MIN_LEADERBOARD_COVERAGE
  };
  return {
    distanceKm: distanceMs > 0 ? rounded(distanceKm, 2) : null,
    distanceSource: gpsMs > 0 && obdDistanceMs > 0 ? 'gps-with-obd-speed-fallback' : gpsMs > 0 ? 'gps' : obdDistanceMs > 0 ? 'obd-speed' : 'unavailable',
    distanceMethod: 'bounded-adjacent-gps-or-trapezoidal-obd-speed',
    avgSpeed: speedMs > 0 ? rounded(speedIntegral / speedMs, 1) : null,
    avgSpeedMethod: 'time-weighted-obd-speed-with-gps-speed-fallback',
    estimatedFuelUsedLitres: fuelMs > 0 ? rounded(litres, 6) : null,
    estimatedFuelEconomyKmL: rounded(economy, 2),
    economyDistanceKm: economyMs > 0 ? rounded(economyDistanceKm, 4) : null,
    economyFuelUsedLitres: economyMs > 0 ? rounded(economyLitres, 6) : null,
    estimatedFuelSource: 'collector-maf-stoichiometric-petrol-estimate',
    estimatedFuelMethod: 'adjacent-trapezoidal-rate-integration',
    estimatedEconomyMethod: 'paired-obd-speed-distance-over-estimated-litres',
    idleSeconds: idleStateMs > 0 ? idleMs / 1000 : null,
    idleSpeedThresholdKmh: IDLE_SPEED_KMH,
    estimatedIdleFuelLitres: idleFuelMs > 0 ? rounded(idleLitres, 6) : idleStateMs > 0 && idleMs === 0 ? 0 : null,
    quality
  };
}

module.exports = { calculateTripMetrics, normalizeTripRecords, knownSpeed, validGps, MAX_INTERVAL_MS };
