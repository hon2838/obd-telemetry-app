const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { initSqliteStorage } = require('./sqlite_storage');

function probe(dir, engine, body) {
  const code = `
    process.env.NODE_ENV = 'test';
    process.env.OBD_DATA_DIR = ${JSON.stringify(dir)};
    process.env.OBD_STORAGE_ENGINE = ${JSON.stringify(engine)};
    process.env.OBD_API_KEY = 'f'.repeat(64);
    const { fastify } = require(${JSON.stringify(path.join(__dirname, 'server.js'))});
    const headers = { 'x-api-key': process.env.OBD_API_KEY };
    (async () => { await fastify.ready(); ${body}; await fastify.close(); })()
      .catch(error => { process.stderr.write(error.stack); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }));
}

describe.each(['json', 'sqlite'])('%s fuel-estimate telemetry contract', engine => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-fuel-estimate-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('accepts idle zero and preserves all fields through API reads and restart', () => {
    const result = probe(dir, engine, `
      const time = Date.now();
      const ingest = await fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers,
        payload: [{ eventId: 'fuel-idle', timestamp: time, speed: 0, mafGps: 3.24,
          fuelSystemStatus: 2, estimatedFuelRateLph: 1.057959184, estimatedFuelEconomyKmL: 0 }] });
      const urls = ['/api/telemetry/latest', '/api/telemetry/snapshot',
        '/api/telemetry/changes?cursor=0', '/api/telemetry/series?start=' + time + '&end=' + time];
      const reads = [];
      for (const url of urls) {
        const response = await fastify.inject({ method: 'GET', url, headers });
        const value = response.json();
        reads.push({ status: response.statusCode, record: Array.isArray(value) ? value[0] : value.records ? value.records[0] : value });
      }
      process.stdout.write(JSON.stringify({ status: ingest.statusCode, reads }));
    `);
    expect(result.status).toBe(201);
    for (const read of result.reads) {
      expect(read.status).toBe(200);
      expect(read.record).toMatchObject({ mafGps: 3.24, fuelSystemStatus: 2,
        estimatedFuelRateLph: 1.057959184, estimatedFuelEconomyKmL: 0 });
    }
    const restored = probe(dir, engine, `
      const response = await fastify.inject({ method: 'GET', url: '/api/telemetry/latest', headers });
      process.stdout.write(response.body);
    `);
    expect(restored).toMatchObject({ eventId: 'fuel-idle', mafGps: 3.24, fuelSystemStatus: 2,
      estimatedFuelRateLph: 1.057959184, estimatedFuelEconomyKmL: 0 });
  });

  test('accepts absent/null legacy values and rejects malformed fuel inputs', () => {
    const result = probe(dir, engine, `
      const valid = await fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers,
        payload: [{ timestamp: Date.now(), eventId: 'legacy' },
          { timestamp: Date.now(), eventId: 'unavailable', mafGps: null, fuelSystemStatus: null,
            estimatedFuelRateLph: null, estimatedFuelEconomyKmL: null }] });
      const invalid = [ ['mafGps', -1], ['mafGps', 655.36], ['mafGps', 'NaN'],
        ['fuelSystemStatus', -1], ['fuelSystemStatus', 256], ['fuelSystemStatus', 2.5],
        ['estimatedFuelRateLph', -1], ['estimatedFuelRateLph', 1001],
        ['estimatedFuelEconomyKmL', -1], ['estimatedFuelEconomyKmL', 1000001] ];
      const statuses = [];
      for (const [field, value] of invalid) {
        const response = await fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers,
          payload: [{ timestamp: Date.now(), [field]: value }] });
        statuses.push([field, value, response.statusCode]);
      }
      const overflow = await fastify.inject({ method: 'POST', url: '/api/telemetry/batch',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: '[{"timestamp":' + Date.now() + ',"mafGps":1e400}]' });
      process.stdout.write(JSON.stringify({ status: valid.statusCode, statuses, overflow: overflow.statusCode }));
    `);
    expect(result.status).toBe(201);
    expect(result.statuses.filter(row => row[2] !== 400)).toEqual([]);
    expect(result.overflow).toBe(400);
  });
});

test('SQLite upgrade preserves old rows and detects conflicting fuel replay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-fuel-upgrade-'));
  const file = path.join(dir, 'telemetry.sqlite');
  let storage;
  try {
    storage = initSqliteStorage(file);
    storage.appendBatch([{ timestamp: 1700000000000, eventId: 'old', ingestSeq: 1 }]);
    storage.close();
    const legacy = new DatabaseSync(file);
    for (const column of ['maf_gps', 'fuel_system_status', 'estimated_fuel_rate_lph', 'estimated_fuel_economy_kml']) {
      legacy.exec('ALTER TABLE telemetry DROP COLUMN ' + column);
    }
    legacy.close();
    storage = initSqliteStorage(file);
    expect(storage.loadAllRecords()[0]).toMatchObject({ eventId: 'old', ingestSeq: 1 });
    expect(storage.loadAllRecords()[0].estimatedFuelEconomyKmL).toBeUndefined();
    const record = { timestamp: 1700000000001, eventId: 'new', ingestSeq: 2, estimatedFuelEconomyKmL: 0 };
    expect(storage.appendBatchIdempotent([record])).toBe(1);
    expect(storage.appendBatchIdempotent([record])).toBe(0);
    expect(() => storage.appendBatchIdempotent([{ ...record, estimatedFuelEconomyKmL: 1 }])).toThrow(/different telemetry/);
    expect(storage.loadAllRecords()[1].estimatedFuelEconomyKmL).toBe(0);
  } finally {
    if (storage) storage.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
