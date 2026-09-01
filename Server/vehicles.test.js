// Tests for multi-vehicle support: the vehicle registry CRUD, legacy
// data migration (records without vehicleId belong to the default
// vehicle), per-vehicle drive segmentation, per-vehicle command
// queueing, and ?vehicle= scoping on read endpoints.
//
// Runs against a temp data dir (OBD_DATA_DIR) so the real
// Server/data store files are never polluted by test ingest.
const path = require('path');
const fs = require('fs');

const TEST_API_KEY = 'a'.repeat(64);
const TEST_DATA_DIR = path.join(__dirname, '__test_data_vehicles__');
fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
process.env.OBD_API_KEY = TEST_API_KEY;
process.env.OBD_DATA_DIR = TEST_DATA_DIR;

const {
  fastify,
  segmentDrives,
  telemetryDataStore,
  vehiclesStore,
  DEFAULT_VEHICLE_ID,
} = require('./server');

const AUTH = { 'x-api-key': TEST_API_KEY };

async function createVehicle(payload) {
  return fastify.inject({
    method: 'POST',
    url: '/api/vehicles',
    headers: AUTH,
    payload,
  });
}

describe('Multi-vehicle support', () => {
  beforeEach(() => {
    telemetryDataStore.length = 0;
  });

  afterAll(async () => {
    await fastify.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('vehicle registry', () => {
    it('boot ensures the default vehicle exists', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/api/vehicles' });
      expect(res.statusCode).toBe(200);
      const vehicles = res.json();
      expect(vehicles.some(v => v.id === DEFAULT_VEHICLE_ID)).toBe(true);
      // Record counts are exposed so the UI can warn before deletes
      expect(vehicles[0]).toHaveProperty('recordCount');
    });

    it('creates a vehicle with a server-generated id', async () => {
      const res = await createVehicle({ name: 'Test Car A' });
      expect(res.statusCode).toBe(201);
      const vehicle = res.json();
      expect(vehicle.id).toMatch(/^veh-[0-9a-f]{8}$/);
      expect(vehicle.name).toBe('Test Car A');
      expect(vehiclesStore.some(v => v.id === vehicle.id)).toBe(true);
    });

    it('creates a vehicle with an explicit id and tank size', async () => {
      const res = await createVehicle({ name: 'Axia', vehicleId: 'axia', tankLitres: 36 });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe('axia');
    });

    it('rejects invalid vehicle ids: reserved, duplicate, malformed', async () => {
      const reserved = await createVehicle({ name: 'X', vehicleId: 'default' });
      expect(reserved.statusCode).toBe(400);

      const duplicate = await createVehicle({ name: 'X', vehicleId: 'axia' });
      expect(duplicate.statusCode).toBe(409);

      const malformed = await createVehicle({ name: 'X', vehicleId: 'bad id!' });
      expect(malformed.statusCode).toBe(400);
    });

    it('rejects names that are empty or too long', async () => {
      expect((await createVehicle({ name: '' })).statusCode).toBe(400);
      expect((await createVehicle({ name: 'x'.repeat(65) })).statusCode).toBe(400);
    });

    it('requires a matching API key when one is provided', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/vehicles',
        headers: { 'x-api-key': 'b'.repeat(64) },
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('renames a vehicle via PUT', async () => {
      await createVehicle({ name: 'Rename Me', vehicleId: 'rename-me' });
      const res = await fastify.inject({
        method: 'PUT',
        url: '/api/vehicles/rename-me',
        headers: AUTH,
        payload: { name: 'Renamed' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Renamed');
    });
  });

  describe('legacy data migration', () => {
    it('treats records without a vehicleId as the default vehicle', () => {
      telemetryDataStore.push({ timestamp: 1000, speed: 50, rpm: 2000, latitude: 3.1, longitude: 101.6 });
      const drives = segmentDrives();
      expect(drives.length).toBe(1);
      expect(drives[0].vehicleId).toBe(DEFAULT_VEHICLE_ID);
      expect(drives[0].id).toBe(`${DEFAULT_VEHICLE_ID}-1`);
    });
  });

  describe('per-vehicle drive segmentation', () => {
    it('never merges two vehicles reporting over the same window', async () => {
      await createVehicle({ name: 'Car A', vehicleId: 'car-a' });
      await createVehicle({ name: 'Car B', vehicleId: 'car-b' });
      const base = Date.now();
      // Interleave two cars' points inside the same 5-minute window
      telemetryDataStore.push(
        { timestamp: base, speed: 50, rpm: 2000, latitude: 3.1, longitude: 101.6, vehicleId: 'car-a' },
        { timestamp: base + 1000, speed: 60, rpm: 2100, latitude: 1.1, longitude: 103.6, vehicleId: 'car-b' },
        { timestamp: base + 60000, speed: 55, rpm: 2200, latitude: 3.2, longitude: 101.7, vehicleId: 'car-a' },
        { timestamp: base + 61000, speed: 65, rpm: 2300, latitude: 1.2, longitude: 103.7, vehicleId: 'car-b' },
      );

      const all = segmentDrives();
      expect(all.length).toBe(2);

      const a = segmentDrives('car-a');
      expect(a.length).toBe(1);
      expect(a[0].vehicleId).toBe('car-a');
      expect(a[0].summary.pointCount).toBe(2);
    });

    it('scopes drives by the 5-minute gap within one vehicle', async () => {
      await createVehicle({ name: 'Car A', vehicleId: 'car-a' });
      const base = Date.now();
      telemetryDataStore.push(
        { timestamp: base, speed: 50, rpm: 2000, vehicleId: 'car-a' },
        { timestamp: base + 6 * 60 * 1000, speed: 40, rpm: 1800, vehicleId: 'car-a' },
      );
      const drives = segmentDrives('car-a');
      expect(drives.length).toBe(2);
      expect(drives.map(d => d.id)).toEqual(['car-a-1', 'car-a-2']);
    });
  });

  describe('telemetry ingest', () => {
    const makeRecord = (ts, extra = {}) => ({ timestamp: ts, latitude: 3.1, longitude: 101.6, gpsSpeed: 0, ...extra });

    it('accepts a batch without vehicleId into the default vehicle', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: AUTH,
        payload: [makeRecord(1)],
      });
      expect(res.statusCode).toBe(201);
      expect(telemetryDataStore[telemetryDataStore.length - 1].vehicleId).toBe(DEFAULT_VEHICLE_ID);
    });

    it('rejects a batch referencing an unknown vehicle without writing anything', async () => {
      const before = telemetryDataStore.length;
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: AUTH,
        payload: [makeRecord(2, { vehicleId: 'ghost-car' })],
      });
      expect(res.statusCode).toBe(400);
      expect(telemetryDataStore.length).toBe(before);
    });

    it('stamps a valid vehicleId and scopes reads to that vehicle', async () => {
      await createVehicle({ name: 'Scope Car', vehicleId: 'scope-car' });
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: AUTH,
        payload: [makeRecord(3, { vehicleId: 'scope-car' })],
      });
      expect(res.statusCode).toBe(201);

      const scoped = await fastify.inject({ method: 'GET', url: '/api/telemetry/history?vehicle=scope-car&limit=10' });
      expect(scoped.statusCode).toBe(200);
      expect(scoped.json().length).toBe(1);

      // Empty (but 200) for a different registered vehicle
      const other = await fastify.inject({ method: 'GET', url: '/api/telemetry/history?vehicle=axia&limit=10' });
      expect(other.statusCode).toBe(200);
      expect(other.json().length).toBe(0);
    });

    it('rejects reads with an unknown vehicle param', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/api/telemetry/latest?vehicle=nope' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('per-vehicle command queue', () => {
    it('drains only the commands belonging to the syncing vehicle', async () => {
      await createVehicle({ name: 'Queue Car', vehicleId: 'queue-car' });

      const q1 = await fastify.inject({
        method: 'POST', url: '/api/commands', headers: AUTH,
        payload: { command: 'read_dtc', vehicleId: 'queue-car' },
      });
      expect(q1.statusCode).toBe(200);
      const q2 = await fastify.inject({
        method: 'POST', url: '/api/commands', headers: AUTH,
        payload: { command: 'clear_dtc' }, // default vehicle
      });
      expect(q2.statusCode).toBe(200);

      // car syncs: only its own command comes back
      const sync1 = await fastify.inject({
        method: 'POST', url: '/api/telemetry/batch', headers: AUTH,
        payload: [{ timestamp: Date.now(), latitude: 0, longitude: 0, gpsSpeed: 0, vehicleId: 'queue-car' }],
      });
      expect(sync1.json().commands).toEqual([{ command: 'read_dtc', vehicleId: 'queue-car' }]);

      // default vehicle syncs: gets the default-vehicle command
      const sync2 = await fastify.inject({
        method: 'POST', url: '/api/telemetry/batch', headers: AUTH,
        payload: [{ timestamp: Date.now(), latitude: 0, longitude: 0, gpsSpeed: 0 }],
      });
      expect(sync2.json().commands).toEqual([{ command: 'clear_dtc', vehicleId: DEFAULT_VEHICLE_ID }]);

      // both queues are now drained
      const sync3 = await fastify.inject({
        method: 'POST', url: '/api/telemetry/batch', headers: AUTH,
        payload: [{ timestamp: Date.now(), latitude: 0, longitude: 0, gpsSpeed: 0, vehicleId: 'queue-car' }],
      });
      expect(sync3.json().commands).toEqual([]);
    });

    it('rejects queueing a command for an unknown vehicle', async () => {
      const res = await fastify.inject({
        method: 'POST', url: '/api/commands', headers: AUTH,
        payload: { command: 'read_dtc', vehicleId: 'ghost-car' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('vehicle deletion safety', () => {
    it('refuses deleting a vehicle that owns data without reassignment', async () => {
      await createVehicle({ name: 'Doomed', vehicleId: 'doomed' });
      await fastify.inject({
        method: 'POST', url: '/api/fuel-logs', headers: AUTH,
        payload: { litres: 20, odometer: 50000, vehicleId: 'doomed' },
      });

      const denied = await fastify.inject({ method: 'DELETE', url: '/api/vehicles/doomed', headers: AUTH });
      expect(denied.statusCode).toBe(409);

      // Data is untouched after the refused delete
      const logs = await fastify.inject({ method: 'GET', url: '/api/fuel-logs?vehicle=doomed' });
      expect(logs.json().length).toBe(1);
    });

    it('reassigns records to the default vehicle on explicit request', async () => {
      const res = await fastify.inject({
        method: 'DELETE', url: '/api/vehicles/doomed?reassign=default', headers: AUTH,
      });
      expect(res.statusCode).toBe(200);

      // The deleted vehicle is gone from the registry...
      const registry = await fastify.inject({ method: 'GET', url: '/api/vehicles' });
      expect(registry.json().some(v => v.id === 'doomed')).toBe(false);

      // ...and its records now live under the default vehicle
      const defaultScope = await fastify.inject({ method: 'GET', url: `/api/fuel-logs?vehicle=${DEFAULT_VEHICLE_ID}` });
      expect(defaultScope.json().some(l => l.odometer === 50000)).toBe(true);
    });

    it('refuses deleting the default vehicle', async () => {
      const res = await fastify.inject({ method: 'DELETE', url: `/api/vehicles/${DEFAULT_VEHICLE_ID}`, headers: AUTH });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('fuel and maintenance scoping', () => {
    it('scopes fuel stats to the requested vehicle', async () => {
      await createVehicle({ name: 'Stats Car', vehicleId: 'stats-car' });
      await fastify.inject({
        method: 'POST', url: '/api/fuel-logs', headers: AUTH,
        payload: [
          { litres: 20, odometer: 100000, vehicleId: 'stats-car' },
          { litres: 20, odometer: 100400, vehicleId: 'stats-car' },
        ],
      });
      const stats = await fastify.inject({ method: 'GET', url: '/api/fuel-stats?vehicle=stats-car' });
      expect(stats.statusCode).toBe(200);
      expect(stats.json().totalDistance).toBe(400);
      expect(stats.json().logCount).toBe(2);
    });

    it('scopes maintenance status to the requested vehicle', async () => {
      await createVehicle({ name: 'Maint Car', vehicleId: 'maint-car' });
      await fastify.inject({
        method: 'POST', url: '/api/maintenance', headers: AUTH,
        payload: { name: 'Oil', intervalKm: 5000, vehicleId: 'maint-car' },
      });
      const status = await fastify.inject({ method: 'GET', url: '/api/maintenance/status?vehicle=maint-car' });
      expect(status.statusCode).toBe(200);
      expect(status.json().okCount).toBe(1);

      const defaultStatus = await fastify.inject({ method: 'GET', url: '/api/maintenance/status' });
      // The default vehicle has no maintenance items of its own
      expect(defaultStatus.json().okCount).toBe(0);
    });
  });
});
