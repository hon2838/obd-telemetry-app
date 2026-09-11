const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const TEST_API_KEY = 'o'.repeat(64);
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-optimization-'));
process.env.OBD_API_KEY = TEST_API_KEY;
process.env.OBD_DATA_DIR = TEST_DATA_DIR;
process.env.OBD_INITIAL_ADMIN_PASSWORD = 'InitialAdminPass123!';

let backend;
let fastify;
let telemetryDataStore;
let fuelLogsStore;
let maintenanceStore;
let usersStore;
let vehiclesStore;
let hashPassword;
const auth = { 'x-api-key': TEST_API_KEY };

function cookieValue(setCookie) {
  return String(setCookie).split(';')[0];
}

beforeAll(async () => {
  backend = require('./server');
  ({ fastify, telemetryDataStore, fuelLogsStore, maintenanceStore, usersStore, vehiclesStore, hashPassword } = backend);
  await fastify.ready();
});

afterAll(async () => {
  if (fastify) await fastify.close();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test('telemetry dedupe is durable, per vehicle, and reports accepted and duplicate IDs', async () => {
  const first = await fastify.inject({
    method: 'POST', url: '/api/telemetry/batch', headers: auth,
    payload: [
      { timestamp: 100, eventId: 'same', speed: 1 },
      { timestamp: 101, eventId: 'same', speed: 2 },
      { timestamp: 102, eventId: 'other', speed: 3 }
    ]
  });
  expect(first.statusCode).toBe(201);
  expect(first.json().acceptedIds).toEqual(['same', 'other']);
  expect(first.json().duplicateIds).toEqual(['same']);

  const retry = await fastify.inject({
    method: 'POST', url: '/api/telemetry/batch', headers: auth,
    payload: [{ timestamp: 999, eventId: 'same', speed: 99 }]
  });
  expect(retry.statusCode).toBe(201);
  expect(retry.json().acceptedIds).toEqual([]);
  expect(retry.json().duplicateIds).toEqual(['same']);
  expect(telemetryDataStore.filter(r => r.eventId === 'same')).toHaveLength(1);
});

test('concurrent telemetry mutations serialize without duplicate IDs', async () => {
  const responses = await Promise.all([
    fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers: auth, payload: [{ timestamp: 200, eventId: 'parallel-a' }] }),
    fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers: auth, payload: [{ timestamp: 201, eventId: 'parallel-b' }] })
  ]);
  expect(responses.map(r => r.statusCode)).toEqual([201, 201]);
  expect(new Set(telemetryDataStore.filter(r => /^parallel-/.test(r.eventId)).map(r => r.ingestSeq)).size).toBe(2);
});

test('failed telemetry persistence is retryable and does not mutate memory or dedupe', async () => {
  const dbPath = path.join(TEST_DATA_DIR, 'telemetry.json');
  // Ingest commits through the synchronous file transaction (staging +
  // journal + rename), so the failure is injected during staging write.
  const originalWriteSync = fs.writeFileSync;
  fs.writeFileSync = (file, ...rest) => {
    if (String(file).includes('telemetry.json.txn')) throw new Error('simulated staging write failure');
    return originalWriteSync.call(fs, file, ...rest);
  };
  const failed = await fastify.inject({
    method: 'POST', url: '/api/telemetry/batch', headers: auth,
    payload: [{ timestamp: 300, eventId: 'retry-after-disk-failure' }]
  });
  fs.writeFileSync = originalWriteSync;
  expect(failed.statusCode).toBe(503);
  expect(failed.json().retryable).toBe(true);
  expect(telemetryDataStore.some(r => r.eventId === 'retry-after-disk-failure')).toBe(false);

  const retried = await fastify.inject({
    method: 'POST', url: '/api/telemetry/batch', headers: auth,
    payload: [{ timestamp: 300, eventId: 'retry-after-disk-failure' }]
  });
  expect(retried.statusCode).toBe(201);
  expect(retried.json().acceptedIds).toEqual(['retry-after-disk-failure']);
});

test('latest uses capture timestamp and changes expose scoped durable sequences', async () => {
  await fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers: auth, payload: [
    { timestamp: 1000, eventId: 'capture-new', speed: 10 },
    { timestamp: 900, eventId: 'capture-late', speed: 9 }
  ] });
  const latest = await fastify.inject({ method: 'GET', url: '/api/telemetry/latest', headers: auth });
  expect(latest.json().eventId).toBe('capture-new');

  const page = await fastify.inject({ method: 'GET', url: '/api/telemetry/changes?cursor=0&limit=2', headers: auth });
  expect(page.statusCode).toBe(200);
  expect(page.json().records).toHaveLength(2);
  expect(page.json().records[0].ingestSeq).toBeLessThan(page.json().records[1].ingestSeq);
  expect(typeof page.json().nextCursor).toBe('number');
  expect(typeof page.json().hasMore).toBe('boolean');
  expect((await fastify.inject({ method: 'GET', url: '/api/telemetry/changes?cursor=-1', headers: auth })).statusCode).toBe(400);
});

test('fuel and maintenance ingestion dedupe by vehicle and preserve legacy requests', async () => {
  const fuel = await fastify.inject({ method: 'POST', url: '/api/fuel-logs', headers: auth, payload: [
    { litres: 10, odometer: 100, eventId: 'fuel-1' },
    { litres: 11, odometer: 110, eventId: 'fuel-1' }
  ] });
  expect(fuel.statusCode).toBe(201);
  expect(fuel.json().acceptedIds).toEqual(['fuel-1']);
  expect(fuel.json().duplicateIds).toEqual(['fuel-1']);

  const maintenance = await fastify.inject({ method: 'POST', url: '/api/maintenance', headers: auth, payload: {
    name: 'Oil', intervalKm: 500, eventId: 'maint-1'
  } });
  expect(maintenance.statusCode).toBe(201);
  expect(maintenance.json().acceptedIds).toEqual(['maint-1']);
  expect(fuelLogsStore.some(r => r.eventId === 'fuel-1')).toBe(true);
  expect(maintenanceStore.some(r => r.eventId === 'maint-1')).toBe(true);
});

test('cookie sessions require CSRF, expose it through login/me, and revoke on logout', async () => {
  const password = hashPassword('CookieUserPass123!');
  usersStore.push({ id: 'usr-cookie', username: 'cookie-user', role: 'user', passwordSalt: password.salt, passwordHash: password.hash, vehicles: ['default'], mustChangePassword: false });
  const login = await fastify.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'cookie-user', password: 'CookieUserPass123!' } });
  expect(login.statusCode).toBe(200);
  const setCookie = Array.isArray(login.headers['set-cookie'])
    ? login.headers['set-cookie'][0]
    : login.headers['set-cookie'];
  expect(setCookie).toMatch(/HttpOnly/);
  expect(setCookie).toMatch(/SameSite=Strict/);
  const cookie = cookieValue(setCookie);
  const csrf = login.json().csrfToken;

  const me = await fastify.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  expect(me.json().csrfToken).toBe(csrf);
  const denied = await fastify.inject({ method: 'POST', url: '/api/fuel-logs', headers: { cookie }, payload: { litres: 1, odometer: 1 } });
  expect(denied.statusCode).toBe(403);
  const allowed = await fastify.inject({ method: 'POST', url: '/api/fuel-logs', headers: { cookie, 'x-csrf-token': csrf }, payload: { litres: 1, odometer: 1 } });
  expect(allowed.statusCode).toBe(201);
  const logout = await fastify.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': csrf } });
  expect(logout.statusCode).toBe(200);
  expect((await fastify.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
});

test('trip cache invalidates after a late telemetry sample and tank change', async () => {
  vehiclesStore.push({ id: 'cache-car', name: 'Cache Car', tankLitres: 20, createdAt: Date.now() });
  const payload = [{ timestamp: 5000, vehicleId: 'cache-car', fuelLevel: 90, latitude: 1, longitude: 1, speed: 20 }, { timestamp: 5001, vehicleId: 'cache-car', fuelLevel: 80, latitude: 1, longitude: 1.01, speed: 20 }];
  expect((await fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers: auth, payload })).statusCode).toBe(201);
  const first = await fastify.inject({ method: 'GET', url: '/api/drives?vehicle=cache-car', headers: auth });
  expect(first.statusCode).toBe(200);
  expect(first.json()[0].summary.pointCount).toBe(2);
  const initialEfficiency = first.json()[0].summary.fuelEfficiencyKmL;
  expect((await fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers: auth, payload: [{ timestamp: 5002, vehicleId: 'cache-car', speed: 30 }] })).statusCode).toBe(201);
  const second = await fastify.inject({ method: 'GET', url: '/api/drives?vehicle=cache-car', headers: auth });
  expect(second.json()[0].summary.pointCount).toBe(3);
  expect((await fastify.inject({ method: 'PUT', url: '/api/vehicles/cache-car', headers: auth, payload: { tankLitres: 40 } })).statusCode).toBe(200);
  const afterTankChange = await fastify.inject({ method: 'GET', url: '/api/drives?vehicle=cache-car', headers: auth });
  expect(afterTankChange.json()[0].summary.fuelEfficiencyKmL).not.toBe(initialEfficiency);
});

test('persisted ingest sequences survive a server module restart', async () => {
  const before = await fastify.inject({ method: 'GET', url: '/api/telemetry/changes?cursor=0&limit=1000', headers: auth });
  const lastBeforeRestart = before.json().records.at(-1).ingestSeq;
  const probe = `
    process.env.OBD_API_KEY = ${JSON.stringify(TEST_API_KEY)};
    process.env.OBD_DATA_DIR = ${JSON.stringify(TEST_DATA_DIR)};
    process.env.NODE_ENV = 'test';
    const { telemetryDataStore } = require(${JSON.stringify(path.join(__dirname, 'server.js'))});
    const sequences = telemetryDataStore.map(record => record.ingestSeq);
    if (!sequences.includes(${lastBeforeRestart})) process.exit(2);
    process.stdout.write(String(Math.max(...sequences)));
  `;
  const output = execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  expect(Number(output)).toBe(lastBeforeRestart);
});
