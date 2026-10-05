const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { calculateFuel } = require('./routes/fuel');
const { parseDtcCodes, getDtcInfo, classifyDtcRead } = require('./routes/dtc');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-refill-diagnostics-'));
process.env.OBD_DATA_DIR = dataDir;
process.env.OBD_API_KEY = 'a'.repeat(64);
fs.writeFileSync(path.join(dataDir, 'diagnostics.json'), JSON.stringify({ byVehicle: { default: {
  latestDtc: { code: 'Scan failed: unavailable', timestamp: 10 },
  latestClearStatus: { success: null, timestamp: null }
} } }));
fs.writeFileSync(path.join(dataDir, 'fuel_logs.json'), JSON.stringify([
  { id: 'legacy-1', timestamp: 1, odometer: 100, litres: 20 },
  { id: 'legacy-2', timestamp: 2, odometer: 400, litres: 20 }
]));
const { fastify, devicesStore } = require('./server');
const AUTH = { 'x-api-key': process.env.OBD_API_KEY };
const log = (vehicleId, timestamp, odometer, litres, fillState) => ({ vehicleId, timestamp, odometer, litres, fillState });
const post = (url, payload, headers = AUTH) => fastify.inject({ method: 'POST', url, headers, payload });
const get = url => fastify.inject({ method: 'GET', url, headers: AUTH });

beforeAll(async () => {
  await post('/api/vehicles', { vehicleId: 'refill-a', name: 'A' });
  await post('/api/vehicles', { vehicleId: 'refill-b', name: 'B' });
  devicesStore.push({ id: 'dtc-reader', vehicleId: 'default', tokenHash: crypto.createHash('sha256').update('test-reader-token').digest('hex') });
});
afterAll(async () => {
  await fastify.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

it('uses separate vehicle full-to-full cycles with all intervening partial litres', () => {
  const result = calculateFuel([
    log('a', 1, 1000, 30, 'full'), log('b', 2, 10000, 50, 'full'),
    log('a', 3, 1100, 5, 'partial'), log('b', 4, 10200, 20, 'full'),
    log('a', 5, 1300, 15, 'full'), log('a', 6, 1400, 10, 'full')
  ]);
  expect(result.stats).toMatchObject({ cycleCount: 3, totalDistance: 600, cycleDistance: 600,
    cycleLitres: 50, averageKmPerLitre: 12, bestKmPerLitre: 15, worstKmPerLitre: 10, totalLitres: 130 });
  expect(result.logs.find(entry => entry.timestamp === 5)).toMatchObject({ economy: 15, cycleLitres: 20, cycleDistance: 300 });
  expect(result.logs.find(entry => entry.fillState === 'partial').economy).toBeNull();
});

it('keeps unknown historical fills ineligible and restarts at a known full baseline', () => {
  const result = calculateFuel([
    log('a', 1, 100, 20, 'full'), log('a', 2, 200, 5, undefined),
    log('a', 3, 300, 10, 'full'), log('a', 4, 500, 20, 'full')
  ]);
  expect(result.stats).toMatchObject({ cycleCount: 1, averageKmPerLitre: 10, unknownFillCount: 1 });
  expect(result.logs.find(entry => entry.timestamp === 2)).toMatchObject({ fillState: 'unknown', economy: null });
  expect(result.logs.find(entry => entry.timestamp === 3).economyStatus).toBe('full-baseline');
});

it('invalid and reset odometers cannot produce a consumption cycle', () => {
  expect(calculateFuel([log('a', 1, 500, 20, 'full'), log('a', 2, 400, 20, 'full')]).stats.cycleCount).toBe(0);
  expect(calculateFuel([log('a', 1, 100, 20, 'full'), log('a', 2, 100, 20, 'full')]).stats.cycleCount).toBe(0);
});

it.each([
  { litres: 0, odometer: 10 }, { litres: -1, odometer: 10 }, { litres: null, odometer: 10 },
  { litres: true, odometer: 10 }, { litres: ' ', odometer: 10 }, { litres: 5, odometer: -1 },
  { litres: 5, odometer: null }, { litres: 5, odometer: false }, { litres: 5, odometer: '' },
  { litres: 5, odometer: 10, fillState: 'FULL' }, { litres: 5, odometer: 10, fillState: null }
])('rejects invalid refill payload without persisting: %j', async payload => {
  const before = JSON.parse(fs.readFileSync(path.join(dataDir, 'fuel_logs.json')));
  expect((await post('/api/fuel-logs', payload)).statusCode).toBe(400);
  expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'fuel_logs.json')))).toEqual(before);
});

it('normalizes old records to unknown and preserves default distance compatibility', async () => {
  const logs = (await get('/api/fuel-logs?vehicle=default')).json();
  expect(logs).toHaveLength(2);
  expect(logs.every(entry => entry.fillState === 'unknown' && entry.economy === null)).toBe(true);
  expect((await get('/api/fuel-stats?vehicle=default')).json()).toMatchObject({ totalDistance: 300, cycleCount: 0 });
});

it('persists fill states, deduplicates full events, and scopes fleet and row calculations', async () => {
  const payload = [
    { ...log('refill-a', 10, 1000, 20, 'full'), eventId: 'full-start' },
    log('refill-b', 11, 10000, 40, 'full'), log('refill-a', 12, 1100, 5, 'partial'),
    log('refill-b', 13, 10200, 20, 'full'), { ...log('refill-a', 14, 1300, 15, 'full'), eventId: 'full-end' }
  ];
  expect((await post('/api/fuel-logs', payload)).statusCode).toBe(201);
  const retry = (await post('/api/fuel-logs', payload[4])).json();
  expect(retry.duplicateIds).toEqual(['full-end']);
  expect((await get('/api/fuel-stats?vehicle=refill-a')).json()).toMatchObject({ cycleCount: 1, averageKmPerLitre: 15, totalDistance: 300 });
  expect((await get('/api/fuel-stats')).json()).toMatchObject({ cycleCount: 2, averageKmPerLitre: 12.5, totalDistance: 800 });
  const rows = (await get('/api/fuel-logs')).json();
  expect(rows.find(row => row.eventId === 'full-end')).toMatchObject({ economy: 15, cycleLitres: 20 });
  expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'fuel_logs.json'))).find(row => row.eventId === 'full-end').fillState).toBe('full');
});

it('surfaces previously stored raw failure as unknown without a confirmed result', async () => {
  const state = (await get('/api/dtc?vehicle=default')).json();
  expect(state.latest.latestDtc).toEqual({ code: '', timestamp: null });
  expect(state.latest.latestReadStatus).toMatchObject({ success: false, timestamp: 10, error: 'Scan failed: unavailable' });
});

it('parses hex-tail canonical DTCs and refuses invalid categories and lookup payloads', async () => {
  expect(parseDtcCodes('p0a1f, u3AbC B1234 C0FFF P4000 P0G12 U9AAA')).toEqual(['P0A1F', 'U3ABC', 'B1234', 'C0FFF']);
  expect(getDtcInfo('p0a1f')).toMatchObject({ code: 'P0A1F' });
  expect(getDtcInfo('P4000')).toBeNull();
  expect((await post('/api/dtc/lookup', { codes: ['p0a1f', 'u3abc'] })).json().map(detail => detail.code)).toEqual(['P0A1F', 'U3ABC']);
  for (const code of ['P4000', 'U9999', 'P0G12', null, 123]) {
    expect((await post('/api/dtc/lookup', { codes: [code] })).statusCode).toBe(400);
  }
  expect((await get('/api/dtc/lookup/P4000')).statusCode).toBe(400);
});

it('distinguishes explicit empty reads from failures and preserves confirmed codes', async () => {
  expect(classifyDtcRead('')).toMatchObject({ success: true, codes: [] });
  expect(classifyDtcRead('NO DATA')).toMatchObject({ success: false });
  expect(classifyDtcRead(', ,')).toMatchObject({ success: false });
  expect(classifyDtcRead('P0300 read failed')).toMatchObject({ success: false });
  expect((await post('/api/dtc', { dtc: null })).statusCode).toBe(400);
  expect((await post('/api/dtc', { dtc: 'p0a1f', timestamp: 100 })).json().readSuccess).toBe(true);
  expect((await post('/api/telemetry/dtc', { dtc: 'Scan failed: adapter disconnected', timestamp: 200 })).json().readSuccess).toBe(false);
  let state = (await get('/api/dtc?vehicle=default')).json();
  expect(state.latest.latestDtc).toEqual({ code: 'P0A1F', timestamp: 100 });
  expect(state.latest.latestReadStatus).toMatchObject({ success: false, timestamp: 200 });
  expect(state.history.at(-1)).toMatchObject({ success: false, codes: [], error: 'Scan failed: adapter disconnected' });
  expect((await post('/api/dtc', { dtc: ', ,', timestamp: 250 })).json().readSuccess).toBe(false);
  state = (await get('/api/dtc?vehicle=default')).json();
  expect(state.latest.latestDtc.code).toBe('P0A1F');
  expect(state.latest.latestReadStatus).toMatchObject({ success: false, error: ', ,' });
  await post('/api/dtc', { dtc: 'No DTCs', timestamp: 300 });
  state = (await get('/api/dtc?vehicle=default')).json();
  expect(state.latest.latestDtc.code).toBe('No trouble codes found');
  expect(state.latest.latestReadStatus.success).toBe(true);
  expect(state.history.at(-1)).toMatchObject({ success: true, codes: [] });
});

it('durable read failures preserve last confirmed hexadecimal codes and ACK retry is idempotent', async () => {
  const device = { 'x-device-token': 'test-reader-token', 'x-obd-command-protocol': '2' };
  const ackRead = async (status, result) => {
    expect((await post('/api/commands', { command: 'read_dtc' })).statusCode).toBe(200);
    const pending = await fastify.inject({ method: 'GET', url: '/api/commands/pending', headers: device });
    const payload = { id: pending.json().commands[0].id, status, result };
    const ack = await post('/api/commands/ack', payload, device);
    expect(ack.statusCode).toBe(200);
    expect((await post('/api/commands/ack', payload, device)).json().alreadyAcknowledged).toBe(true);
  };
  await ackRead('completed', { dtc: 'p0a1f u3abc' });
  let state = (await get('/api/dtc?vehicle=default')).json();
  expect(state.latest.latestDtc.code).toBe('P0A1F, U3ABC');
  expect(state.history.at(-1).codes).toEqual(['P0A1F', 'U3ABC']);
  await ackRead('failed', { error: 'Adapter disconnected' });
  state = (await get('/api/dtc?vehicle=default')).json();
  expect(state.latest.latestDtc.code).toBe('P0A1F, U3ABC');
  expect(state.latest.latestReadStatus).toMatchObject({ success: false, error: 'Adapter disconnected' });
  expect(state.history.at(-1)).toMatchObject({ success: false, codes: [] });
  await ackRead('completed', { dtc: ', ,' });
  state = (await get('/api/dtc?vehicle=default')).json();
  expect(state.latest.latestDtc.code).toBe('P0A1F, U3ABC');
  expect(state.latest.latestReadStatus).toMatchObject({ success: false, error: ', ,' });
  await ackRead('completed', { dtc: 'NO DATA' });
  expect((await get('/api/dtc?vehicle=default')).json().latest.latestReadStatus).toMatchObject({ success: false, error: 'NO DATA' });
  await ackRead('failed', { error: { unexpected: 'object' } });
  expect((await get('/api/dtc?vehicle=default')).json().latest.latestReadStatus.error).toBe('DTC read failed');
  await ackRead('unknown', { reason: 'Read interrupted' });
  expect((await get('/api/dtc?vehicle=default')).json().latest.latestReadStatus).toMatchObject({ success: false, error: 'Read interrupted' });
});

it('restores historical fill states, cycles, and failed read status in a new server process', async () => {
  // A genuine restart reads persisted state, rather than sharing test memory.
  const run = spawnSync(process.execPath, ['-e', `
    const { fastify } = require('./server');
    (async () => {
      const headers = { 'x-api-key': process.env.OBD_API_KEY };
      const stats = (await fastify.inject({ method: 'GET', url: '/api/fuel-stats?vehicle=refill-a', headers })).json();
      const logs = (await fastify.inject({ method: 'GET', url: '/api/fuel-logs?vehicle=default', headers })).json();
      const diagnostics = (await fastify.inject({ method: 'GET', url: '/api/dtc?vehicle=default', headers })).json();
      console.log('RESULT:' + JSON.stringify({ stats, logs, diagnostics }));
      await fastify.close();
    })().catch(error => { console.error(error); process.exit(1); });
  `], { cwd: __dirname, env: process.env, encoding: 'utf8', timeout: 15000 });
  expect(run.status).toBe(0);
  const line = run.stdout.split('\n').find(line => line.startsWith('RESULT:'));
  const result = JSON.parse(line.slice(7));
  expect(result.stats).toMatchObject({ cycleCount: 1, averageKmPerLitre: 15 });
  expect(result.logs.every(entry => entry.fillState === 'unknown')).toBe(true);
  expect(result.diagnostics.latest.latestDtc.code).toBe('P0A1F, U3ABC');
  expect(result.diagnostics.latest.latestReadStatus).toMatchObject({ success: false, error: 'Read interrupted' });
});
