const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { initSqliteStorage } = require('./sqlite_storage');

const API_KEY = 's'.repeat(64);
let tempDir;

function runServer(dataDir, script = "require('./server')") {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: __dirname,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      OBD_API_KEY: API_KEY,
      OBD_DATA_DIR: dataDir,
      OBD_STORAGE_ENGINE: 'sqlite',
      OBD_INITIAL_ADMIN_PASSWORD: 'InitialAdminPass123!'
    }
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-sqlite-startup-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('SQLite startup rejects an incompatible existing database instead of falling back to JSON', () => {
  const db = new DatabaseSync(path.join(tempDir, 'telemetry.sqlite'));
  db.exec('CREATE TABLE telemetry (id INTEGER PRIMARY KEY, timestamp INTEGER, vehicle_id TEXT, event_id TEXT, ingest_seq INTEGER)');
  db.close();
  fs.writeFileSync(path.join(tempDir, 'telemetry.json'), JSON.stringify([
    { timestamp: 1700000000000, eventId: 'stale-json-record' }
  ]));

  const result = runServer(tempDir);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('SQLite storage initialization failed; refusing to start');
  expect(result.stderr).not.toContain('falling back to JSON');
});

test('SQLite startup fails closed when an empty existing database has unclear JSON provenance', () => {
  const storage = initSqliteStorage(path.join(tempDir, 'telemetry.sqlite'));
  storage.close();
  fs.writeFileSync(path.join(tempDir, 'telemetry.json'), JSON.stringify([
    { timestamp: 1700000000000, eventId: 'possibly-unimported-history' }
  ]));

  const result = runServer(tempDir);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('SQLite is empty while legacy JSON exists');
  expect(result.stderr).toContain('no completed-import marker');
});

test('a marked intentionally-empty SQLite database ignores stale legacy JSON', () => {
  const storage = initSqliteStorage(path.join(tempDir, 'telemetry.sqlite'));
  storage.markLegacyImportComplete();
  storage.close();
  fs.writeFileSync(path.join(tempDir, 'telemetry.json'), JSON.stringify([
    { timestamp: 1700000000000, eventId: 'stale-json-record' }
  ]));

  const script = `
    const server = require('./server');
    server.fastify.ready().then(async () => {
      process.stdout.write(JSON.stringify(server.telemetryDataStore));
      await server.fastify.close();
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = runServer(tempDir, script);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([]);
});

test('SQLite restart serves changes in ingest sequence after an offline backfill', () => {
  const storage = initSqliteStorage(path.join(tempDir, 'telemetry.sqlite'));
  storage.appendBatch([
    { timestamp: 1700000200000, vehicleId: 'default', eventId: 'uploaded-first', ingestSeq: 1 },
    { timestamp: 1700000100000, vehicleId: 'default', eventId: 'offline-backfill', ingestSeq: 2 }
  ]);
  storage.close();

  const script = `
    const server = require('./server');
    server.fastify.ready().then(async () => {
      const first = await server.fastify.inject({ method: 'GET', url: '/api/telemetry/changes?cursor=0&limit=1', headers: { 'x-api-key': process.env.OBD_API_KEY } });
      const second = await server.fastify.inject({ method: 'GET', url: '/api/telemetry/changes?cursor=1&limit=1', headers: { 'x-api-key': process.env.OBD_API_KEY } });
      process.stdout.write(JSON.stringify({ first: first.json(), second: second.json() }));
      await server.fastify.close();
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = runServer(tempDir, script);
  expect(result.status).toBe(0);
  const pages = JSON.parse(result.stdout);
  expect(pages.first.records.map(record => record.ingestSeq)).toEqual([1]);
  expect(pages.first.nextCursor).toBe(1);
  expect(pages.first.hasMore).toBe(true);
  expect(pages.second.records.map(record => record.ingestSeq)).toEqual([2]);
  expect(pages.second.nextCursor).toBe(2);
});

test('legacy JSON rows receive sequences that are stored in the new SQLite database', () => {
  const legacy = [
    { timestamp: 1700000200000, eventId: 'legacy-newer-capture' },
    { timestamp: 1700000100000, eventId: 'legacy-offline-backfill' }
  ];
  const jsonPath = path.join(tempDir, 'telemetry.json');
  fs.writeFileSync(jsonPath, JSON.stringify(legacy));

  const result = runServer(tempDir);
  expect(result.status).toBe(0);
  const storage = initSqliteStorage(path.join(tempDir, 'telemetry.sqlite'));
  expect(storage.loadAllRecords().map(record => record.ingestSeq)).toEqual([1, 2]);
  storage.close();
  expect(JSON.parse(fs.readFileSync(jsonPath, 'utf8'))).toEqual(legacy);
});
