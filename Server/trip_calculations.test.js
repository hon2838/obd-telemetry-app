const { calculateTripMetrics, normalizeTripRecords, MAX_INTERVAL_MS } = require('./trip_calculations');
const point = (seconds, overrides = {}) => ({ timestamp: seconds * 1000, speed: 60, rpm: 2000, fuelSystemStatus: 2, estimatedFuelRateLph: 6, ...overrides });

test('integrates irregular capture intervals rather than averaging sample economy', () => {
  const result = calculateTripMetrics([
    point(0, { speed: 20, estimatedFuelRateLph: 2, estimatedFuelEconomyKmL: 999 }),
    point(10, { speed: 40, estimatedFuelRateLph: 4, estimatedFuelEconomyKmL: 1 }),
    point(30, { speed: 100, estimatedFuelRateLph: 10, estimatedFuelEconomyKmL: 999 })
  ]);
  expect(result.avgSpeed).toBe(56.7);
  expect(result.estimatedFuelUsedLitres).toBeCloseTo(170 / 3600, 6);
  expect(result.estimatedFuelEconomyKmL).toBe(10);
  expect(result.quality.economyCoverageRatio).toBe(1);
});

test('partial fuel coverage uses distance from exactly the same eligible intervals', () => {
  const result = calculateTripMetrics([point(0), point(10), point(20, { speed: 120, estimatedFuelRateLph: null })]);
  expect(result.distanceKm).toBe(0.42);
  expect(result.economyDistanceKm).toBeCloseTo(1 / 6, 4);
  expect(result.estimatedFuelEconomyKmL).toBe(10);
  expect(result.quality.fuelCoverageRatio).toBe(0.5);
  expect(result.quality.efficiencyLeaderboardEligible).toBe(false);
});

test('missing speed can cover fuel but never manufacture economy or idle time', () => {
  const result = calculateTripMetrics([point(0, { speed: null }), point(10, { speed: null })]);
  expect(result.estimatedFuelUsedLitres).toBeCloseTo(1 / 60, 6);
  expect(result.estimatedFuelEconomyKmL).toBeNull();
  expect(result.economyDistanceKm).toBeNull();
  expect(result.idleSeconds).toBeNull();
  expect(result.avgSpeed).toBeNull();
  expect(result.distanceKm).toBeNull();
});

test('GPS-speed zero does not classify missing OBD speed as idle or paired economy', () => {
  const result = calculateTripMetrics([point(0, { speed: null, gpsSpeed: 0, latitude: 0, longitude: 0 }), point(10, { speed: null, gpsSpeed: 0, latitude: 0, longitude: 0 })]);
  expect(result.avgSpeed).toBeNull();
  expect(result.estimatedFuelEconomyKmL).toBeNull();
  expect(result.idleSeconds).toBeNull();
  expect(result.distanceKm).toBeNull();
});

test.each([null, undefined, 0, NaN])('unknown/stopped RPM %s excludes positive fuel rates and idle classification', rpm => {
  const result = calculateTripMetrics([point(0, { speed: 0, rpm }), point(10, { speed: 0, rpm })]);
  expect(result.estimatedFuelUsedLitres).toBeNull();
  expect(result.estimatedFuelEconomyKmL).toBeNull();
  expect(result.idleSeconds).toBe(rpm === 0 ? 0 : null);
  expect(result.quality.fuelCoverageRatio).toBe(0);
});

test('running stationary intervals have observed idle duration/fuel and legitimate zero economy', () => {
  const result = calculateTripMetrics([point(0, { speed: 0 }), point(10, { speed: 0 })]);
  expect(result.estimatedFuelEconomyKmL).toBe(0);
  expect(result.distanceKm).toBe(0);
  expect(result.idleSeconds).toBe(10);
  expect(result.estimatedIdleFuelLitres).toBeCloseTo(1 / 60, 6);
  expect(result.quality.idleStateCoverageRatio).toBe(1);
  expect(result.quality.idleFuelCoverageRatio).toBe(1);
});

test('known idle with missing rate retains duration while idle fuel remains unavailable', () => {
  const result = calculateTripMetrics([point(0, { speed: 0, estimatedFuelRateLph: null }), point(10, { speed: 0, estimatedFuelRateLph: null })]);
  expect(result.idleSeconds).toBe(10);
  expect(result.estimatedIdleFuelLitres).toBeNull();
  expect(result.quality.idleFuelCoverageRatio).toBe(0);
});

test('engine on/off or idle/moving transitions do not become whole idle intervals', () => {
  const result = calculateTripMetrics([point(0, { speed: 0 }), point(10, { speed: 0, rpm: 0 }), point(20, { speed: 60 })]);
  expect(result.idleSeconds).toBe(0);
  expect(result.estimatedIdleFuelLitres).toBe(0);
  expect(result.estimatedFuelUsedLitres).toBeNull();
});

test('eligible zero fuel rate stays zero litres; division by zero remains unavailable', () => {
  const result = calculateTripMetrics([point(0, { estimatedFuelRateLph: 0 }), point(10, { estimatedFuelRateLph: 0 })]);
  expect(result.estimatedFuelUsedLitres).toBe(0);
  expect(result.estimatedFuelEconomyKmL).toBeNull();
  expect(result.quality.fuelCoverageRatio).toBe(1);
});

test.each([undefined, null, 1, 4, 8, 16])('missing or non-closed-loop fuel status %s excludes supplied rates', fuelSystemStatus => {
  const result = calculateTripMetrics([point(0, { fuelSystemStatus }), point(10, { fuelSystemStatus })]);
  expect(result.estimatedFuelUsedLitres).toBeNull();
  expect(result.estimatedFuelEconomyKmL).toBeNull();
  expect(result.quality.fuelCoverageRatio).toBe(0);
});

test('sorts offline backfill by capture time and deduplicates replay/capture endpoints without merging fields', () => {
  const records = [point(20, { ingestSeq: 1 }), point(0, { ingestSeq: 2, eventId: 'a' }),
    point(0, { ingestSeq: 3, eventId: 'a' }), point(10, { ingestSeq: 4 }),
    point(10, { ingestSeq: 5, estimatedFuelRateLph: null }), point(40, { timestamp: 'bad' })];
  const result = calculateTripMetrics(records);
  expect(result.avgSpeed).toBe(60);
  expect(result.estimatedFuelUsedLitres).toBeNull();
  expect(result.quality.duplicateCount).toBe(2);
  expect(result.quality.invalidTimestampCount).toBe(1);
  expect(normalizeTripRecords(records).points.map(p => p.timestamp)).toEqual([0, 10000, 20000]);
  expect(calculateTripMetrics([...records].reverse()).quality.duplicateCount).toBe(2);
});

test('30-second bound is inclusive and long gaps never contribute distance, fuel, speed or idle', () => {
  const result = calculateTripMetrics([point(0, { speed: 0 }), point(MAX_INTERVAL_MS / 1000, { speed: 0 }),
    point(90, { speed: 0 }), point(100, { speed: 0 })]);
  expect(result.idleSeconds).toBe(40);
  expect(result.quality.coverageRatio).toBe(0.4);
  expect(result.quality.gapCount).toBe(1);
  expect(result.quality.maxGapSeconds).toBe(60);
  expect(result.estimatedFuelUsedLitres).toBeCloseTo(6 * 40 / 3600, 6);
});

test('never bridges a missing GPS fix and labels bounded OBD fallback', () => {
  const result = calculateTripMetrics([
    point(0, { latitude: 1, longitude: 1 }), point(10, { latitude: null, longitude: null }),
    point(20, { latitude: 1, longitude: 1.001 }), point(30, { latitude: 1, longitude: 1.002 })
  ]);
  expect(result.distanceKm).toBe(0.44);
  expect(result.distanceSource).toBe('gps-with-obd-speed-fallback');
  expect(result.quality.distanceCoverageRatio).toBe(1);
});

test('rejects impossible GPS jumps and uses OBD distance without inventing GPS coverage', () => {
  const result = calculateTripMetrics([point(0, { latitude: 1, longitude: 1 }), point(1, { latitude: 2, longitude: 2 })]);
  expect(result.distanceSource).toBe('obd-speed');
  expect(result.distanceKm).toBe(0.02);
  expect(result.quality.rejectedGpsIntervals).toBe(1);
});

test('equator/meridian fixes are valid, zero-zero sentinel is unavailable', () => {
  const result = calculateTripMetrics([point(0, { speed: null, latitude: 0, longitude: 1 }), point(10, { speed: null, latitude: 0, longitude: 1.001 })]);
  expect(result.distanceSource).toBe('gps');
  expect(result.distanceKm).toBe(0.11);
  expect(calculateTripMetrics([point(0, { speed: null, latitude: 0, longitude: 0 }), point(10, { speed: null, latitude: 0, longitude: 0 })]).distanceKm).toBeNull();
});

test('empty and singleton trips have unavailable integration rather than fabricated zero totals', () => {
  for (const records of [[], [point(0)]]) {
    const result = calculateTripMetrics(records);
    expect(result.estimatedFuelUsedLitres).toBeNull();
    expect(result.estimatedFuelEconomyKmL).toBeNull();
    expect(result.idleSeconds).toBeNull();
    expect(result.quality.coverageRatio).toBeNull();
    expect(result.quality.efficiencyLeaderboardEligible).toBe(false);
  }
});

test('only adequately covered paired estimates qualify for ranking', () => {
  expect(calculateTripMetrics([0, 30, 60, 90].map(t => point(t))).quality.efficiencyLeaderboardEligible).toBe(true);
  const partial = calculateTripMetrics([0, 30, 60, 90].map(t => point(t, { estimatedFuelRateLph: t >= 60 ? null : 6 })));
  expect(partial.estimatedFuelEconomyKmL).toBe(10);
  expect(partial.quality.efficiencyLeaderboardEligible).toBe(false);
});

test('never integrates between different vehicle endpoints or deduplicates their identities together', () => {
  const records = [point(0, { vehicleId: 'a', eventId: 'same' }), point(10, { vehicleId: 'b', eventId: 'same' })];
  expect(normalizeTripRecords(records).points).toHaveLength(2);
  expect(() => calculateTripMetrics(records)).toThrow('one vehicle');
});
