const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { initSqliteStorage } = require('./sqlite_storage');

const SERVER_FILE = path.join(__dirname, 'server.js');
const API_KEY = 'k'.repeat(64);

function runServerProbe(dataDir, body) {
  const code = `
    process.env.NODE_ENV = 'test';
    process.env.OBD_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.OBD_STORAGE_ENGINE = 'sqlite';
    process.env.OBD_API_KEY = ${JSON.stringify(API_KEY)};
    process.env.OBD_INITIAL_ADMIN_PASSWORD = 'BoundedAdmin123!';
    const backend = require(${JSON.stringify(SERVER_FILE)});
    const fastify = backend.fastify;
    const auth = { 'x-api-key': process.env.OBD_API_KEY };
    (async () => {
      await fastify.ready();
      ${body};
      await fastify.close();
    })().catch(err => {
      process.stderr.write(String(err.stack || err));
      process.exit(1);
    });
  `;
  const output = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  return JSON.parse(output);
}

describe('Bounded SQLite Telemetry Engine', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-bounded-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('does not load records into memory on boot and serves all endpoints boundedly', () => {
    // 1. Populate SQLite store directly with 2,000 records
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    const baseTime = 1700000000000;
    const records = [];
    for (let i = 1; i <= 2000; i++) {
      records.push({
        timestamp: baseTime + i * 1000,
        vehicleId: i % 2 === 0 ? 'car-a' : 'default',
        eventId: `ev-${i}`,
        rpm: 1000 + (i % 5000),
        speed: 20 + (i % 100),
        accelTime: i === 100 ? 5.2 : (i === 200 ? 4.8 : null),
        ingestSeq: i
      });
    }
    storage.appendBatch(records);
    storage.close();

    // 2. Probe server startup and operations
    const result = runServerProbe(tempDir, `
      // Verify in-memory store is empty (bounded!)
      const inMemoryLength = backend.telemetryDataStore.length;

      // Verify health check reflects sqlite record count
      const health = await fastify.inject({ method: 'GET', url: '/healthz' });
      const healthBody = health.json();

      // Verify /api/telemetry/latest
      const latest = await fastify.inject({ method: 'GET', url: '/api/telemetry/latest', headers: auth });
      const latestBody = latest.json();

      // Verify /api/telemetry/snapshot
      const snapshot = await fastify.inject({ method: 'GET', url: '/api/telemetry/snapshot?limit=10', headers: auth });
      const snapshotBody = snapshot.json();

      // Verify /api/telemetry/changes
      const changes = await fastify.inject({ method: 'GET', url: '/api/telemetry/changes?cursor=1990&limit=5', headers: auth });
      const changesBody = changes.json();

      // Verify /api/telemetry/series
      const series = await fastify.inject({
        method: 'GET',
        url: '/api/telemetry/series?start=' + ${baseTime + 1000} + '&end=' + ${baseTime + 10000} + '&points=5',
        headers: auth
      });
      const seriesBody = series.json();

      // Verify /api/telemetry/history
      const history = await fastify.inject({ method: 'GET', url: '/api/telemetry/history?limit=10', headers: auth });
      const historyHeaders = {
        limit: history.headers['x-telemetry-page-limit'],
        complete: history.headers['x-telemetry-page-complete'],
        total: history.headers['x-telemetry-total-matched']
      };

      // Verify /api/performance/runs
      const perfRuns = await fastify.inject({ method: 'GET', url: '/api/performance/runs', headers: auth });
      const perfRunsBody = perfRuns.json();

      // Verify /api/performance/records
      const perfRecs = await fastify.inject({ method: 'GET', url: '/api/performance/records', headers: auth });
      const perfRecsBody = perfRecs.json();

      process.stdout.write(JSON.stringify({
        inMemoryLength,
        telemetryRecords: healthBody.telemetry_records,
        latestEventId: latestBody.eventId,
        snapshotCount: snapshotBody.records.length,
        snapshotCursor: snapshotBody.snapshotCursor,
        changesCount: changesBody.records.length,
        changesNextCursor: changesBody.nextCursor,
        changesHasMore: changesBody.hasMore,
        seriesCount: seriesBody.length,
        historyHeaders,
        perfRunsCount: perfRunsBody.length,
        perfBest0to100: perfRecsBody.best0to100?.time,
        perfTopSpeed: perfRecsBody.topSpeed?.speed,
        perfHighestRpm: perfRecsBody.highestRpm?.rpm
      }));
    `);

    expect(result.inMemoryLength).toBe(0);
    expect(result.telemetryRecords).toBe(2000);
    expect(result.latestEventId).toBe('ev-2000');
    expect(result.snapshotCount).toBe(10);
    expect(result.snapshotCursor).toBe(2000);
    expect(result.changesCount).toBe(5);
    expect(result.changesNextCursor).toBe(1995);
    expect(result.changesHasMore).toBe(true);
    expect(result.historyHeaders).toEqual({
      limit: '10',
      complete: 'false',
      total: '2000'
    });
    expect(result.perfRunsCount).toBe(2);
    expect(result.perfBest0to100).toBe(4.8);
    expect(result.perfTopSpeed).toBeGreaterThan(0);
    expect(result.perfHighestRpm).toBeGreaterThan(0);
  });

  test('batch ingestion uses SQLite deduplication without loading or inflating memory', () => {
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    storage.appendBatch([
      { timestamp: 1700000000000, vehicleId: 'default', eventId: 'existing-1', ingestSeq: 1 },
      { timestamp: 1700000001000, vehicleId: 'default', eventId: 'existing-2', ingestSeq: 2 }
    ]);
    storage.close();

    const result = runServerProbe(tempDir, `
      // Ingest a batch containing 1 duplicate and 2 new events
      const batchRes = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: auth,
        payload: [
          { timestamp: 1700000002000, vehicleId: 'default', eventId: 'existing-1', speed: 10 },
          { timestamp: 1700000003000, vehicleId: 'default', eventId: 'new-3', speed: 30 },
          { timestamp: 1700000004000, vehicleId: 'default', eventId: 'new-4', speed: 40 }
        ]
      });
      const batchBody = batchRes.json();
      const inMemoryLength = backend.telemetryDataStore.length;
      const count = backend.sqliteStorage.count();
      const latest = backend.sqliteStorage.getLatest();

      process.stdout.write(JSON.stringify({
        status: batchRes.statusCode,
        acceptedIds: batchBody.acceptedIds,
        duplicateIds: batchBody.duplicateIds,
        inMemoryLength,
        count,
        latestEventId: latest.eventId,
        latestSeq: latest.ingestSeq
      }));
    `);

    expect(result.status).toBe(201);
    expect(result.acceptedIds).toEqual(['new-3', 'new-4']);
    expect(result.duplicateIds).toEqual(['existing-1']);
    expect(result.inMemoryLength).toBe(0); // Memory remains bounded!
    expect(result.count).toBe(4);
    expect(result.latestEventId).toBe('new-4');
    expect(result.latestSeq).toBe(4);
  });

  test('vehicle deletion with reassign=default updates SQLite in place without RangeError', () => {
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    storage.appendBatch([
      { timestamp: 1700000000000, vehicleId: 'veh-custom', eventId: 'custom-1', ingestSeq: 1 },
      { timestamp: 1700000001000, vehicleId: 'veh-custom', eventId: 'custom-2', ingestSeq: 2 }
    ]);
    storage.close();

    const result = runServerProbe(tempDir, `
      // Create veh-custom in registry first
      await fastify.inject({
        method: 'POST',
        url: '/api/vehicles',
        headers: auth,
        payload: { vehicleId: 'veh-custom', name: 'Custom Car' }
      });

      // Verify vehicle recordCount before deletion
      const vBefore = await fastify.inject({ method: 'GET', url: '/api/vehicles', headers: auth });
      const countBefore = vBefore.json().find(v => v.id === 'veh-custom')?.recordCount.telemetry;

      // Delete with reassign=default
      const del = await fastify.inject({
        method: 'DELETE',
        url: '/api/vehicles/veh-custom?reassign=default',
        headers: auth
      });

      const inMemoryLength = backend.telemetryDataStore.length;
      const dbVehicles = backend.sqliteStorage.loadAllRecords().map(r => r.vehicleId);

      process.stdout.write(JSON.stringify({
        countBefore,
        deleteStatus: del.statusCode,
        inMemoryLength,
        dbVehicles
      }));
    `);

    expect(result.countBefore).toBe(2);
    expect(result.deleteStatus).toBe(200);
    expect(result.inMemoryLength).toBe(0);
    expect(result.dbVehicles).toEqual(['default', 'default']);
  });
});
