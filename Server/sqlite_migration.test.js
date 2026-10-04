const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const { migrateJsonToSqlite } = require('./scripts/migrate_telemetry_json_to_sqlite');
const { exportSqliteToJson } = require('./scripts/export_sqlite_to_json');
const { initSqliteStorage } = require('./sqlite_storage');

describe('SQLite telemetry migration and integrity', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-sqlite-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('migration uses active runtime schema and export preserves records, defaults, and ingestSeq', () => {
    const jsonPath = path.join(tempDir, 'telemetry.json');
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    const exportedPath = path.join(tempDir, 'telemetry_exported.json');
    const sourceRecords = [
      {
        eventId: 'event-newer', vehicleId: 'car1', timestamp: 1700000003500,
        receivedAt: 1700000003600, ingestSeq: 2, speed: 45, rpm: 2100,
        accOn: true, alertCoolant: false
      },
      {
        timestamp: 1700000000000, receivedAt: 1700000000100,
        ingestSeq: 1, speed: 40, rpm: 1800
      },
      {
        eventId: 'event-legacy', vehicleId: '', timestamp: 1700000010000,
        receivedAt: 1700000010100, ingestSeq: 3, fuelLevel: 50
      },
      {
        eventId: 'event-null', timestamp: 1700000015000,
        receivedAt: 1700000015100, vehicleId: 'car1', ingestSeq: 4, rpm: null, speed: 0
      }
    ];
    fs.writeFileSync(jsonPath, JSON.stringify(sourceRecords, null, 2));

    const stats = migrateJsonToSqlite(jsonPath, sqlitePath);
    expect(stats).toMatchObject({ sourceCount: 4, insertedCount: 4, finalDbCount: 4, skippedDuplicates: 0 });

    // Open with the exact runtime storage implementation and confirm its schema.
    const storage = initSqliteStorage(sqlitePath);
    try {
      const columns = storage.db.prepare('PRAGMA table_info(telemetry)').all().map(column => column.name);
      expect(columns).toContain('rpm');
      expect(columns).toContain('ingest_seq');
      expect(columns).not.toContain('data');
      expect(storage.db.prepare('PRAGMA synchronous').get().synchronous).toBe(2);
      expect(storage.loadAllRecords().map(record => record.ingestSeq)).toEqual([1, 2, 3, 4]);
    } finally {
      storage.close();
    }

    const exportStats = exportSqliteToJson(sqlitePath, exportedPath);
    expect(exportStats.exportedCount).toBe(4);
    const reimported = JSON.parse(fs.readFileSync(exportedPath, 'utf8'));
    expect(reimported).toEqual([
      { timestamp: 1700000000000, vehicleId: 'default', receivedAt: 1700000000100, speed: 40, rpm: 1800, ingestSeq: 1 },
      { timestamp: 1700000003500, vehicleId: 'car1', receivedAt: 1700000003600, eventId: 'event-newer', rpm: 2100, speed: 45, accOn: true, alertCoolant: false, ingestSeq: 2 },
      { timestamp: 1700000010000, vehicleId: 'default', receivedAt: 1700000010100, eventId: 'event-legacy', fuelLevel: 50, ingestSeq: 3 },
      { timestamp: 1700000015000, vehicleId: 'car1', receivedAt: 1700000015100, eventId: 'event-null', speed: 0, ingestSeq: 4 }
    ]);
  });

  test('migration handles 150000 records without exceeding the function argument limit', () => {
    const jsonPath = path.join(tempDir, 'large.json');
    const sqlitePath = path.join(tempDir, 'large.sqlite');
    const count = 150000;
    const start = 1700000000000;
    fs.writeFileSync(jsonPath, JSON.stringify(Array.from({ length: count }, (_, index) => ({
      timestamp: start + (count - index) * 2,
      vehicleId: 'default',
      ingestSeq: index + 1
    }))));

    expect(migrateJsonToSqlite(jsonPath, sqlitePath)).toMatchObject({
      sourceCount: count, insertedCount: count, finalDbCount: count,
      minTimestamp: start + 2, maxTimestamp: start + count * 2
    });
    const db = new DatabaseSync(sqlitePath);
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM telemetry').get().n).toBe(count);
      expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
    } finally {
      db.close();
    }
  }, 30000);

  test('migration preserves a non-empty destination and removes a newly created DB on failure', () => {
    const jsonPath = path.join(tempDir, 'telemetry.json');
    const sqlitePath = path.join(tempDir, 'telemetry.sqlite');
    fs.writeFileSync(jsonPath, JSON.stringify([{ timestamp: 123, eventId: 'one', ingestSeq: 1 }]));

    const storage = initSqliteStorage(sqlitePath);
    storage.appendBatch([{ timestamp: 100, eventId: 'existing', ingestSeq: 1 }]);
    storage.close();
    expect(() => migrateJsonToSqlite(jsonPath, sqlitePath)).toThrow(/not empty/);
    const check = initSqliteStorage(sqlitePath);
    expect(check.count()).toBe(1);
    check.close();

    const badPath = path.join(tempDir, 'bad.sqlite');
    fs.writeFileSync(jsonPath, JSON.stringify([
      { timestamp: 100, vehicleId: 'car', eventId: 'duplicate', ingestSeq: 1 },
      { timestamp: 200, vehicleId: 'car', eventId: 'duplicate', ingestSeq: 2 }
    ]));
    expect(() => migrateJsonToSqlite(jsonPath, badPath)).toThrow();
    expect(fs.existsSync(badPath)).toBe(false);

    fs.writeFileSync(jsonPath, JSON.stringify([{ timestamp: 'bad' }]));
    expect(() => migrateJsonToSqlite(jsonPath, badPath)).toThrow(/invalid timestamp/);
    expect(fs.existsSync(badPath)).toBe(false);

    fs.writeFileSync(jsonPath, JSON.stringify([{ timestamp: 123, mysteryField: 42 }]));
    expect(() => migrateJsonToSqlite(jsonPath, badPath)).toThrow(/unsupported field.*mysteryField/);
    expect(fs.existsSync(badPath)).toBe(false);
  });

  test('runtime repairs legacy sequences once and orders rows by ingest sequence, not timestamp', () => {
    const sqlitePath = path.join(tempDir, 'legacy.sqlite');
    const db = new DatabaseSync(sqlitePath);
    db.exec(`CREATE TABLE telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL,
      vehicle_id TEXT NOT NULL DEFAULT 'default', event_id TEXT, rpm REAL, speed REAL,
      coolant_temp REAL, latitude REAL, longitude REAL, altitude REAL, gps_speed REAL,
      engine_load REAL, throttle_pos REAL, fuel_level REAL, ambient_temp REAL, voltage REAL,
      battery_voltage REAL, accel_time REAL, alert_coolant INTEGER, alert_voltage INTEGER,
      acc_on INTEGER, headlight_on INTEGER, volume REAL, wifi_ssid TEXT, bt_connected INTEGER,
      received_at INTEGER NOT NULL, ingest_seq INTEGER
    )`);
    const insert = db.prepare('INSERT INTO telemetry(timestamp, vehicle_id, event_id, received_at, ingest_seq) VALUES (?, ?, ?, ?, ?)');
    insert.run(300, 'car', 'late', 301, 8);
    insert.run(100, 'car', 'early', 101, null);
    insert.run(200, 'car', 'middle', 201, 8);
    db.close();

    const storage = initSqliteStorage(sqlitePath);
    try {
      const loaded = storage.loadAllRecords();
      expect(loaded.map(record => record.ingestSeq)).toEqual([8, 9, 10]);
      expect(loaded.map(record => record.eventId)).toEqual(['late', 'early', 'middle']);
      expect(storage.ensureIngestSequences()).toBe(0);
    } finally {
      storage.close();
    }
  });

  test('idempotent append rejects sequence reuse for changed telemetry content', () => {
    const storage = initSqliteStorage(path.join(tempDir, 'idempotent.sqlite'));
    try {
      const record = { timestamp: 1000, vehicleId: 'car', eventId: 'evt', speed: 40, ingestSeq: 1 };
      expect(storage.appendBatchIdempotent([record])).toBe(1);
      expect(storage.appendBatchIdempotent([record])).toBe(0);
      expect(() => storage.appendBatchIdempotent([{ ...record, speed: 41 }])).toThrow(/different telemetry record/);
      expect(storage.count()).toBe(1);
    } finally {
      storage.close();
    }
  });

  test('journal operation commits atomically, skips replay, and detects reassignment conflicts', () => {
    const storage = initSqliteStorage(path.join(tempDir, 'journal.sqlite'));
    try {
      const record = { timestamp: 1000, vehicleId: 'old', eventId: 'evt', ingestSeq: 1 };
      expect(storage.applyJournalOperation('append-1', { type: 'append', records: [record] })).toEqual({ applied: true });
      expect(storage.applyJournalOperation('append-1', { type: 'append', records: [record] })).toEqual({ applied: false });
      expect(storage.db.prepare('PRAGMA synchronous').get().synchronous).toBe(2);
      expect(storage.hasReassignConflict('old', 'new')).toBe(false);
      expect(storage.applyJournalOperation('move-1', { type: 'reassignVehicle', oldVehicleId: 'old', newVehicleId: 'new' })).toEqual({ applied: true });
      expect(storage.hasReassignConflict('old', 'new')).toBe(false);
      expect(storage.loadAllRecords()[0].vehicleId).toBe('new');
      storage.appendBatch([{ timestamp: 2000, vehicleId: 'old', eventId: 'evt', ingestSeq: 2 }]);
      expect(storage.hasReassignConflict('old', 'new')).toBe(true);
      expect(() => storage.applyJournalOperation('move-2', { type: 'reassignVehicle', oldVehicleId: 'old', newVehicleId: 'new' })).toThrow(/conflicts/);
    } finally {
      storage.close();
    }
  });

  test('automatic legacy import rejects unsupported fields without writing rows or completion marker', () => {
    const storage = initSqliteStorage(path.join(tempDir, 'unknown.sqlite'));
    try {
      expect(() => storage.importLegacyJson([{ timestamp: 100, rpm: 700, customSensor: 9 }]))
        .toThrow(/unsupported field.*customSensor/);
      expect(storage.count()).toBe(0);
      expect(storage.isLegacyImportComplete()).toBe(false);
    } finally {
      storage.close();
    }
  });
});
