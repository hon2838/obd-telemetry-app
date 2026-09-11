const os = require('os');
const path = require('path');
const fs = require('fs');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-server-'));
process.env.OBD_DATA_DIR = TEST_DATA_DIR;
const TEST_API_KEY = 'a'.repeat(64);
process.env.OBD_API_KEY = TEST_API_KEY;

const { fastify, segmentDrives, getHaversineDistance, telemetryDataStore } = require('./server');
const request = require('supertest');

describe('Server Analytics Logic', () => {
  beforeEach(() => {
    // Clear telemetry data store before each test
    telemetryDataStore.length = 0;
  });

  describe('getHaversineDistance', () => {
    it('calculates the correct distance between two points', () => {
      // Kuala Lumpur to Singapore is roughly 315km
      const distance = getHaversineDistance(3.1390, 101.6869, 1.3521, 103.8198);
      expect(distance).toBeGreaterThan(300);
      expect(distance).toBeLessThan(350);
    });

    it('returns 0 for identical coordinates', () => {
      const distance = getHaversineDistance(3.1390, 101.6869, 3.1390, 101.6869);
      expect(distance).toBe(0);
    });
  });

  describe('segmentDrives & calculateDriverScore', () => {
    it('segments telemetry data into distinct drives based on 5 minute gaps', () => {
      const t1 = Date.now();
      const t2 = t1 + (1000 * 60 * 1); // 1 minute later
      const t3 = t2 + (1000 * 60 * 6); // 6 minutes later (New Drive)
      
      telemetryDataStore.push(
        { timestamp: t1, speed: 50, rpm: 2000, latitude: 3.1, longitude: 101.6 },
        { timestamp: t2, speed: 60, rpm: 2200, latitude: 3.2, longitude: 101.7 },
        { timestamp: t3, speed: 40, rpm: 1800, latitude: 3.3, longitude: 101.8 }
      );

      const drives = segmentDrives();
      expect(drives.length).toBe(2);
      expect(drives[0].summary.pointCount).toBe(2);
      expect(drives[1].summary.pointCount).toBe(1);
    });

    it('deducts driver score for harsh acceleration', () => {
      const t1 = Date.now();
      const t2 = t1 + 5000; // 5 seconds later
      
      telemetryDataStore.push(
        { timestamp: t1, speed: 0, rpm: 1000 },
        // Accelerating from 0 to 60 in 5 seconds = 12 km/h/s (Harsh!)
        { timestamp: t2, speed: 60, rpm: 4500 }
      );

      const drives = segmentDrives();
      expect(drives.length).toBe(1);
      // 100 - 1 (harsh accel) - 0.1 (high rpm penalty because > 4000)
      // Actually high RPM penalty only triggers if count > 10. 
      // So score should be 100 - 1 = 99
      expect(drives[0].summary.driverScore).toBe(99);
      expect(drives[0].summary.harshEvents.accel).toBe(1);
    });

    it('maintains 100 score for smooth driving', () => {
      const t1 = Date.now();
      const t2 = t1 + 5000; // 5 seconds later
      
      telemetryDataStore.push(
        { timestamp: t1, speed: 50, rpm: 2000 },
        // Accelerating from 50 to 55 in 5 seconds = 1 km/h/s (Smooth)
        { timestamp: t2, speed: 55, rpm: 2200 }
      );

      const drives = segmentDrives();
      expect(drives.length).toBe(1);
      expect(drives[0].summary.driverScore).toBe(100);
      expect(drives[0].summary.harshEvents.accel).toBe(0);
      expect(drives[0].summary.harshEvents.brake).toBe(0);
    });
  });
});

describe('API Endpoints Integration', () => {
  afterAll(async () => {
    await fastify.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('POST /api/telemetry/batch', () => {
    it('returns 401 if API key is invalid', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: { 'x-api-key': 'WRONG_KEY' },
        payload: []
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 if API key is the right length but wrong value', async () => {
      // Constant-time comparison must reject the right length
      // with a 401, not crash, when the bytes differ. Uses the
      // same length as TEST_API_KEY to isolate the value from
      // the length check.
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: { 'x-api-key': 'b'.repeat(TEST_API_KEY.length) },
        payload: []
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 if no API key header is sent', async () => {
      // Tests the !apiKey branch in the handler (don't trip
      // the constant-time comparison with an empty buffer).
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        payload: []
      });
      expect(response.statusCode).toBe(401);
    });

    it('ingests telemetry successfully with correct API key', async () => {
      const payload = [{
        timestamp: Date.now(),
        speed: 100,
        rpm: 3000
      }];
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: payload
      });
      
      expect(response.statusCode).toBe(201);
      const json = JSON.parse(response.payload);
      expect(json.success).toBe(true);
      expect(json.message).toContain('Ingested 1 records');
    });

    it('accepts batches of 100 items but rejects larger batches', async () => {
      const record = (index) => ({ timestamp: Date.now() + index, eventId: `batch-limit-${index}` });
      const accepted = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: Array.from({ length: 100 }, (_, index) => record(index))
      });
      expect(accepted.statusCode).toBe(201);
      expect(JSON.parse(accepted.payload).acceptedIds).toHaveLength(100);

      const rejected = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: Array.from({ length: 101 }, (_, index) => record(1000 + index))
      });
      expect(rejected.statusCode).toBe(400);
      expect(JSON.parse(rejected.payload).error).toMatch(/100/);
    });

    it.each([
      ['timestamp before 2020', { timestamp: 1577836799999 }],
      ['timestamp more than one day ahead', { timestamp: Date.now() + 2 * 86400000 }],
      ['latitude below -90', { timestamp: Date.now(), latitude: -90.001 }],
      ['latitude above 90', { timestamp: Date.now(), latitude: 90.001 }],
      ['longitude below -180', { timestamp: Date.now(), longitude: -180.001 }],
      ['longitude above 180', { timestamp: Date.now(), longitude: 180.001 }],
      ['speed below 0', { timestamp: Date.now(), speed: -0.001 }],
      ['speed above 500', { timestamp: Date.now(), speed: 500.001 }],
      ['rpm below 0', { timestamp: Date.now(), rpm: -0.001 }],
      ['rpm above 20000', { timestamp: Date.now(), rpm: 20000.001 }],
      ['coolantTemp below -50', { timestamp: Date.now(), coolantTemp: -50.001 }],
      ['coolantTemp above 250', { timestamp: Date.now(), coolantTemp: 250.001 }],
      ['fuelLevel below 0', { timestamp: Date.now(), fuelLevel: -0.001 }],
      ['fuelLevel above 100', { timestamp: Date.now(), fuelLevel: 100.001 }],
      ['batteryVoltage below 0', { timestamp: Date.now(), batteryVoltage: -0.001 }],
      ['batteryVoltage above 36', { timestamp: Date.now(), batteryVoltage: 36.001 }]
    ])('rejects %s', async (_description, payload) => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: [payload]
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
