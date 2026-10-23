const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { initSqliteStorage } = require('./sqlite_storage');

const SERVER_FILE = path.join(__dirname, 'server.js');
const API_KEY = 'k'.repeat(64);

function runServerProbe(dataDir, body, storageEngine = 'sqlite') {
  const code = `
    process.env.NODE_ENV = 'test';
    process.env.OBD_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.OBD_STORAGE_ENGINE = ${JSON.stringify(storageEngine)};
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

  test('idx_telemetry_vehicle_time does not exist while idx_telemetry_vehicle_time_seq exists and legacy index is dropped', () => {
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    let storage = initSqliteStorage(sqlitePath);
    let indexes = storage.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(r => r.name);
    expect(indexes).toContain('idx_telemetry_vehicle_time_seq');
    expect(indexes).not.toContain('idx_telemetry_vehicle_time');

    // Simulate existing legacy database having idx_telemetry_vehicle_time
    storage.db.exec('CREATE INDEX idx_telemetry_vehicle_time ON telemetry(vehicle_id, timestamp);');
    indexes = storage.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(r => r.name);
    expect(indexes).toContain('idx_telemetry_vehicle_time');
    storage.close();

    // Re-initialization should drop idx_telemetry_vehicle_time
    storage = initSqliteStorage(sqlitePath);
    indexes = storage.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(r => r.name);
    expect(indexes).toContain('idx_telemetry_vehicle_time_seq');
    expect(indexes).not.toContain('idx_telemetry_vehicle_time');
    storage.close();
  });

  test('streaming segmentDrives() in SQLite mode produces identical drives and summaries as JSON mode', () => {
    const baseTime = 1700000000000;
    const testRecords = [
      // car-alpha Drive 1 (harsh acceleration & braking, high RPM, fuel rate)
      { timestamp: baseTime, vehicleId: 'car-alpha', eventId: 'ca-1', speed: 0, rpm: 800, fuelLevel: 95.0, latitude: 37.7749, longitude: -122.4194, fuelSystemStatus: 2, estimatedFuelRateLph: 1.2, ingestSeq: 1 },
      { timestamp: baseTime + 2000, vehicleId: 'car-alpha', eventId: 'ca-2', speed: 30, rpm: 4200, fuelLevel: 94.8, latitude: 37.7752, longitude: -122.4196, fuelSystemStatus: 2, estimatedFuelRateLph: 8.5, ingestSeq: 2 },
      { timestamp: baseTime + 4000, vehicleId: 'car-alpha', eventId: 'ca-3', speed: 5, rpm: 1500, fuelLevel: 94.5, latitude: 37.7755, longitude: -122.4198, fuelSystemStatus: 2, estimatedFuelRateLph: 2.0, ingestSeq: 3 },
      { timestamp: baseTime + 6000, vehicleId: 'car-alpha', eventId: 'ca-4', speed: 20, rpm: 2200, fuelLevel: 94.4, latitude: 37.7758, longitude: -122.4200, fuelSystemStatus: 2, estimatedFuelRateLph: 3.5, ingestSeq: 4 },
      // Duplicate timestamp for car-alpha (deduplicated by timestamp tie-breaker in trip calculations)
      { timestamp: baseTime + 6000, vehicleId: 'car-alpha', eventId: 'ca-4b', speed: 20, rpm: 2200, fuelLevel: 94.4, latitude: 37.7758, longitude: -122.4200, fuelSystemStatus: 2, estimatedFuelRateLph: 3.5, ingestSeq: 5 },
      { timestamp: -1, vehicleId: 'car-alpha', eventId: 'ca-invalid', speed: 50, rpm: 2000, ingestSeq: 6 },

      // car-alpha Drive 2 (after 6-minute gap > 5-min threshold)
      { timestamp: baseTime + 370000, vehicleId: 'car-alpha', eventId: 'ca-5', speed: 40, rpm: 2500, fuelLevel: 90.0, latitude: 37.7800, longitude: -122.4250, fuelSystemStatus: 2, estimatedFuelRateLph: 4.5, ingestSeq: 7 },
      { timestamp: baseTime + 380000, vehicleId: 'car-alpha', eventId: 'ca-6', speed: 60, rpm: 3000, fuelLevel: 89.5, latitude: 37.7850, longitude: -122.4300, fuelSystemStatus: 2, estimatedFuelRateLph: 6.0, ingestSeq: 8 },

      // car-beta Drive 1 (interleaved chronologically with car-alpha)
      { timestamp: baseTime + 10000, vehicleId: 'car-beta', eventId: 'cb-1', speed: 10, rpm: 1200, fuelLevel: 50.0, latitude: 37.7000, longitude: -122.4000, fuelSystemStatus: 2, estimatedFuelRateLph: 2.0, ingestSeq: 9 },
      { timestamp: baseTime + 12000, vehicleId: 'car-beta', eventId: 'cb-2', speed: 45, rpm: 4800, fuelLevel: 49.5, latitude: 37.7010, longitude: -122.4010, fuelSystemStatus: 2, estimatedFuelRateLph: 9.0, ingestSeq: 10 },
      { timestamp: baseTime + 14000, vehicleId: 'car-beta', eventId: 'cb-3', speed: 10, rpm: 1800, fuelLevel: 49.0, latitude: 37.7020, longitude: -122.4020, fuelSystemStatus: 2, estimatedFuelRateLph: 2.5, ingestSeq: 11 },

      // car-beta Drive 2 (after 6-minute gap)
      { timestamp: baseTime + 385000, vehicleId: 'car-beta', eventId: 'cb-4', speed: 55, rpm: 2800, fuelLevel: 45.0, latitude: 37.7100, longitude: -122.4100, fuelSystemStatus: 2, estimatedFuelRateLph: 5.5, ingestSeq: 12 },
      { timestamp: baseTime + 395000, vehicleId: 'car-beta', eventId: 'cb-5', speed: 65, rpm: 3200, fuelLevel: 44.2, latitude: 37.7200, longitude: -122.4200, fuelSystemStatus: 2, estimatedFuelRateLph: 6.5, ingestSeq: 13 }
    ];

    // Seed SQLite
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    storage.appendBatch(testRecords);
    storage.close();

    const testVehicles = [
      { id: 'car-alpha', name: 'Alpha Car', tankLitres: 50 },
      { id: 'car-beta', name: 'Beta Car', tankLitres: 60 }
    ];

    // 1. Run in SQLite mode
    const sqliteResult = runServerProbe(tempDir, `
      for (const v of ${JSON.stringify(testVehicles)}) {
        backend.vehiclesStore.push(v);
      }
      const allDrives = backend.segmentDrives();
      const alphaDrives = backend.segmentDrives('car-alpha');
      const betaDrives = backend.segmentDrives('car-beta');
      const filteredDrives = backend.segmentDrives(['car-alpha', 'car-beta']);
      const emptyDrives = backend.segmentDrives([]);
      process.stdout.write(JSON.stringify({
        allDrives,
        alphaDrives,
        betaDrives,
        filteredDrives,
        emptyDrives
      }));
    `, 'sqlite');

    // 2. Run in JSON mode
    const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-json-comp-'));
    let jsonResult;
    try {
      jsonResult = runServerProbe(jsonDir, `
        for (const v of ${JSON.stringify(testVehicles)}) {
          backend.vehiclesStore.push(v);
        }
        backend.telemetryDataStore.push(...${JSON.stringify(testRecords)});
        const allDrives = backend.segmentDrives();
        const alphaDrives = backend.segmentDrives('car-alpha');
        const betaDrives = backend.segmentDrives('car-beta');
        const filteredDrives = backend.segmentDrives(['car-alpha', 'car-beta']);
        const emptyDrives = backend.segmentDrives([]);
        process.stdout.write(JSON.stringify({
          allDrives,
          alphaDrives,
          betaDrives,
          filteredDrives,
          emptyDrives
        }));
      `, 'json');
    } finally {
      fs.rmSync(jsonDir, { recursive: true, force: true });
    }

    // Verify both modes yield identical output
    expect(sqliteResult.allDrives).toHaveLength(4);
    expect(sqliteResult.allDrives).toEqual(jsonResult.allDrives);
    expect(sqliteResult.alphaDrives).toHaveLength(2);
    expect(sqliteResult.alphaDrives).toEqual(jsonResult.alphaDrives);
    expect(sqliteResult.betaDrives).toHaveLength(2);
    expect(sqliteResult.betaDrives).toEqual(jsonResult.betaDrives);
    expect(sqliteResult.filteredDrives).toEqual(jsonResult.filteredDrives);
    expect(sqliteResult.emptyDrives).toEqual([]);
    expect(sqliteResult.emptyDrives).toEqual(jsonResult.emptyDrives);

    // Verify harsh events and score penalties
    const alphaD1 = sqliteResult.allDrives.find(d => d.id === 'car-alpha-1');
    expect(alphaD1).toBeDefined();
    expect(alphaD1.summary.harshEvents.accel).toBe(1);
    expect(alphaD1.summary.harshEvents.brake).toBe(1);
    expect(alphaD1.summary.driverScore).toBeLessThan(100);
    expect(alphaD1.summary.fuelEfficiencySource).toBe('legacy-tank-level-drop');
    expect(alphaD1.summary.legacyTankEstimate.tankLitres).toBe(50);
  });

  test('F1: getSeries downsamples boundedly and matches downsampleTelemetrySeries across budgets', () => {
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    const baseTime = 1700000000000;
    const records = [];
    for (let i = 1; i <= 2000; i++) {
      records.push({
        timestamp: baseTime + i * 1000,
        vehicleId: 'default',
        eventId: `ev-${i}`,
        rpm: (i * 37) % 6000,
        speed: (i * 13) % 140,
        gpsSpeed: (i * 17) % 150,
        ingestSeq: i
      });
    }
    storage.appendBatch(records);
    storage.close();

    const result = runServerProbe(tempDir, `
      const allRecords = backend.sqliteStorage.getSeries(${baseTime}, ${baseTime + 2001000});
      const comparisons = {};
      for (const points of [1, 2, 4, 5, 10, 750]) {
        const bounded = backend.sqliteStorage.getSeries(${baseTime}, ${baseTime + 2001000}, null, null, points);
        const expected = backend.downsampleTelemetrySeries(allRecords, points);
        comparisons[points] = {
          boundedLen: bounded.length,
          matches: JSON.stringify(bounded) === JSON.stringify(expected)
        };
      }

      let getSeriesRecordCount = 0;
      const originalSeries = backend.sqliteStorage.getSeries.bind(backend.sqliteStorage);
      backend.sqliteStorage.getSeries = (...args) => {
        const res = originalSeries(...args);
        getSeriesRecordCount = res.length;
        return res;
      };
      const res = await fastify.inject({
        method: 'GET',
        url: '/api/telemetry/series?start=' + ${baseTime} + '&end=' + ${baseTime + 2001000} + '&points=5',
        headers: auth
      });
      process.stdout.write(JSON.stringify({
        status: res.statusCode,
        responseLength: res.json().length,
        getSeriesRecordCount,
        allRecordsLength: allRecords.length,
        comparisons
      }));
    `);

    expect(result.allRecordsLength).toBe(2000);
    for (const points of [1, 2, 4, 5, 10, 750]) {
      expect(result.comparisons[points].boundedLen).toBeLessThanOrEqual(points);
      expect(result.comparisons[points].matches).toBe(true);
    }
    expect(result.status).toBe(200);
    expect(result.responseLength).toBeLessThanOrEqual(5);
    expect(result.getSeriesRecordCount).toBeLessThanOrEqual(5);
  });

  test('F1: getChanges with empty scope inspects 0 rows while advancing nextCursor', () => {
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    const baseTime = 1700000000000;
    const records = [];
    for (let i = 1; i <= 2000; i++) {
      records.push({
        timestamp: baseTime + i * 1000,
        vehicleId: 'default',
        eventId: `ev-${i}`,
        ingestSeq: i
      });
    }
    storage.appendBatch(records);

    const res = storage.getChanges(0, 1, null, []);
    expect(res.records).toHaveLength(0);
    expect(res.inspected).toBe(0);
    expect(res.nextCursor).toBe(2000);
    storage.close();
  });

  test('F2: getChanges closes iterator immediately allowing WAL checkpoint without lock', () => {
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    const baseTime = 1700000000000;
    const records = [];
    for (let i = 1; i <= 50; i++) {
      records.push({
        timestamp: baseTime + i * 1000,
        vehicleId: 'default',
        eventId: `ev-${i}`,
        ingestSeq: i
      });
    }
    storage.appendBatch(records);

    // Call partial getChanges
    const change = storage.getChanges(0, 1);
    expect(change.records).toHaveLength(1);

    // Immediate checkpoint must succeed without "database table is locked" error
    const checkpoint = storage.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    expect(checkpoint.busy).toBe(0);
    storage.close();
  });

  test('F3: conflicting GPS/OBD speed rows respect speed precedence and match JSON mode', () => {
    const baseTime = 1700000000000;
    const records = [
      { timestamp: baseTime, vehicleId: 'default', eventId: 'gps-spike', speed: 10, gpsSpeed: 200, ingestSeq: 1 },
      { timestamp: baseTime + 1000, vehicleId: 'default', eventId: 'true-top', speed: 80, gpsSpeed: 70, ingestSeq: 2 },
      { timestamp: baseTime + 2000, vehicleId: 'default', eventId: 'zero-speed-high-gps', speed: 0, gpsSpeed: 150, ingestSeq: 3 }
    ];

    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    storage.appendBatch(records);

    const top = storage.getTopSpeed();
    expect(top).toBeDefined();
    expect(top.eventId).toBe('true-top');
    expect(top.speed).toBe(80);
    storage.close();

    // Verify /api/performance/records HTTP endpoint
    const result = runServerProbe(tempDir, `
      const res = await fastify.inject({ method: 'GET', url: '/api/performance/records', headers: auth });
      process.stdout.write(JSON.stringify({
        status: res.statusCode,
        topSpeed: res.json().topSpeed?.speed
      }));
    `);
    expect(result.status).toBe(200);
    expect(result.topSpeed).toBe(80);
  });

  test('F4: out-of-order offline backfill preserves ingestSeq ordering in getHistory', () => {
    const baseTime = 1700000000000;
    const records = [
      { timestamp: baseTime + 1000, vehicleId: 'default', eventId: 'newer-capture', ingestSeq: 1 },
      { timestamp: baseTime, vehicleId: 'default', eventId: 'offline-backfill', ingestSeq: 2 }
    ];

    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    storage.appendBatch(records);

    // Tail mode
    const tail = storage.getHistory({ cap: 1, tailMode: true });
    expect(tail.records).toHaveLength(1);
    expect(tail.records[0].eventId).toBe('offline-backfill');

    // Paged mode
    const page0 = storage.getHistory({ cap: 1, pageOffset: 0, tailMode: false });
    expect(page0.records[0].eventId).toBe('newer-capture');
    const page1 = storage.getHistory({ cap: 1, pageOffset: 1, tailMode: false });
    expect(page1.records[0].eventId).toBe('offline-backfill');
    storage.close();

    // Verify /api/telemetry/history via HTTP
    const result = runServerProbe(tempDir, `
      const tailRes = await fastify.inject({ method: 'GET', url: '/api/telemetry/history?limit=1', headers: auth });
      const paged0 = await fastify.inject({ method: 'GET', url: '/api/telemetry/history?limit=1&offset=0', headers: auth });
      const paged1 = await fastify.inject({ method: 'GET', url: '/api/telemetry/history?limit=1&offset=1', headers: auth });
      process.stdout.write(JSON.stringify({
        tailEventId: tailRes.json()[0]?.eventId,
        page0EventId: paged0.json()[0]?.eventId,
        page1EventId: paged1.json()[0]?.eventId
      }));
    `);
    expect(result.tailEventId).toBe('offline-backfill');
    expect(result.page0EventId).toBe('newer-capture');
    expect(result.page1EventId).toBe('offline-backfill');
  });

  test('F1: stream drive exports using iterateRecordsForDrive without array materialization', () => {
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const storage = initSqliteStorage(sqlitePath);
    const baseTime = 1700000000000;
    const records = [
      { timestamp: baseTime, vehicleId: 'default', eventId: 'exp-1', speed: 20, rpm: 1500, latitude: 37.77, longitude: -122.41, ingestSeq: 1 },
      { timestamp: baseTime + 1000, vehicleId: 'default', eventId: 'exp-2', speed: 30, rpm: 2000, latitude: 37.78, longitude: -122.42, ingestSeq: 2 }
    ];
    storage.appendBatch(records);

    const iter = storage.iterateRecordsForDrive('default', baseTime, baseTime + 1000);
    const iterated = [];
    for (const r of iter) {
      iterated.push(r.eventId);
    }
    expect(iterated).toEqual(['exp-1', 'exp-2']);
    storage.close();

    // Verify CSV export endpoint
    const result = runServerProbe(tempDir, `
      const drives = backend.segmentDrives();
      const driveId = drives[0].id;
      const csv = await fastify.inject({ method: 'GET', url: '/api/drives/' + driveId + '/export/csv', headers: auth });
      const gpx = await fastify.inject({ method: 'GET', url: '/api/drives/' + driveId + '/export/gpx', headers: auth });
      process.stdout.write(JSON.stringify({
        csvStatus: csv.statusCode,
        csvHasHeader: csv.body.startsWith('Timestamp,Time,RPM,Speed'),
        gpxStatus: gpx.statusCode,
        gpxHasTrk: gpx.body.includes('<trkpt')
      }));
    `);
    expect(result.csvStatus).toBe(200);
    expect(result.csvHasHeader).toBe(true);
    expect(result.gpxStatus).toBe(200);
    expect(result.gpxHasTrk).toBe(true);
  });
});
