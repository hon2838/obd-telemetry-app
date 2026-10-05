const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-trip-summaries-'));
process.env.OBD_DATA_DIR = dir;
process.env.OBD_API_KEY = 't'.repeat(64);
const { fastify, segmentDrives, telemetryDataStore, vehiclesStore } = require('./server');
const headers = { 'x-api-key': process.env.OBD_API_KEY };
const base = Date.now() - 600000;
const point = (seconds, overrides = {}) => ({ timestamp: base + seconds * 1000, speed: 60, rpm: 2000, fuelSystemStatus: 2,
  estimatedFuelRateLph: 6, latitude: 0, longitude: 0, ...overrides });
afterAll(async () => { await fastify.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('segments backfilled mixed vehicles independently and preserves labeled legacy tank semantics', () => {
  telemetryDataStore.push(point(30, { vehicleId: 'a' }), point(0, { vehicleId: 'b', estimatedFuelRateLph: 3 }),
    point(0, { vehicleId: 'a' }), point(30, { vehicleId: 'b', estimatedFuelRateLph: 3 }));
  const drives = segmentDrives();
  expect(drives).toHaveLength(2);
  expect(drives.find(d => d.vehicleId === 'a').summary.estimatedFuelEconomyKmL).toBe(10);
  expect(drives.find(d => d.vehicleId === 'b').summary.estimatedFuelEconomyKmL).toBe(20);
  expect(drives[0].summary.fuelEfficiencySource).toBe('legacy-tank-level-drop');
  expect(drives[0].summary.legacyTankEstimate.tankCapacitySource).toBe('legacy-default-36-litres');
  telemetryDataStore.length = 0;
});

test('drives and leaderboard routes use capture coverage and invalidate cached estimates on late backfill', async () => {
  for (const id of ['trip-good', 'trip-partial', 'trip-tank']) {
    vehiclesStore.push({ id, name: id, tankLitres: 36 });
  }
  const data = [0, 30, 60, 90].flatMap(seconds => [
    point(seconds, { vehicleId: 'trip-good', eventId: `good-${seconds}` }),
    point(seconds, { vehicleId: 'trip-partial', eventId: `partial-${seconds}`, estimatedFuelRateLph: seconds >= 60 ? null : 1 }),
    point(seconds, { vehicleId: 'trip-tank', eventId: `tank-${seconds}`, estimatedFuelRateLph: null,
      fuelLevel: 100 - seconds / 30, latitude: 1, longitude: 1 + seconds / 300000 })
  ]).reverse();
  expect((await fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers, payload: data })).statusCode).toBe(201);
  const drives = await fastify.inject({ method: 'GET', url: '/api/drives', headers });
  expect(drives.statusCode).toBe(200);
  const partial = drives.json().find(d => d.vehicleId === 'trip-partial');
  expect(partial.summary.estimatedFuelEconomyKmL).toBe(60);
  expect(partial.summary.quality.economyCoverageRatio).toBeCloseTo(1 / 3, 4);
  const ranked = await fastify.inject({ method: 'GET', url: '/api/trips/leaderboard', headers });
  expect(ranked.statusCode).toBe(200);
  expect(ranked.json().best_efficiency.map(d => d.vehicleId)).toEqual(['trip-good']);
  const tank = drives.json().find(d => d.vehicleId === 'trip-tank').summary;
  expect(tank.fuelEfficiencyKmL).not.toBeNull();
  expect(tank.estimatedFuelEconomyKmL).toBeNull();
  expect(tank.legacyTankEstimate.reliability).toBe('unvalidated-not-used-for-leaderboard');
  const late = await fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers,
    payload: [point(45, { vehicleId: 'trip-good', eventId: 'good-late', estimatedFuelRateLph: null })] });
  expect(late.statusCode).toBe(201);
  const after = await fastify.inject({ method: 'GET', url: '/api/drives?vehicle=trip-good', headers });
  expect(after.json()[0].summary.quality.economyCoverageRatio).toBeCloseTo(2 / 3, 4);
  const reranked = await fastify.inject({ method: 'GET', url: '/api/trips/leaderboard', headers });
  expect(reranked.json().best_efficiency).toEqual([]);
});
