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

describe.each(['json', 'sqlite'])('%s IAT and MAP telemetry contract', engine => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-iat-map-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('accepts valid iat and map values and preserves them through API reads and restart', () => {
    const result = probe(dir, engine, `
      const time = Date.now();
      const ingest = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers,
        payload: [{
          eventId: 'test-iat-map',
          timestamp: time,
          speed: 60,
          coolantTemp: 88,
          ambientTemp: 30,
          iat: 38,
          map: 101
        }]
      });
      const urls = [
        '/api/telemetry/latest',
        '/api/telemetry/snapshot',
        '/api/telemetry/changes?cursor=0'
      ];
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
      expect(read.record).toMatchObject({ iat: 38, map: 101 });
    }
    const restored = probe(dir, engine, `
      const response = await fastify.inject({ method: 'GET', url: '/api/telemetry/latest', headers });
      process.stdout.write(response.body);
    `);
    expect(restored).toMatchObject({ eventId: 'test-iat-map', iat: 38, map: 101 });
  });

  test('accepts absent/null values and rejects out-of-bounds iat and map', () => {
    const result = probe(dir, engine, `
      const valid = await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers,
        payload: [
          { timestamp: Date.now(), eventId: 'legacy-null', iat: null, map: null },
          { timestamp: Date.now() + 1, eventId: 'legacy-absent' }
        ]
      });
      const invalid = [
        ['iat', -51], ['iat', 151], ['iat', 'hot'],
        ['map', -1], ['map', 501], ['map', 'boost']
      ];
      const rejects = [];
      for (const [field, value] of invalid) {
        const res = await fastify.inject({
          method: 'POST',
          url: '/api/telemetry/batch',
          headers,
          payload: [{ timestamp: Date.now(), eventId: 'bad-' + field, [field]: value }]
        });
        rejects.push({ field, value, status: res.statusCode });
      }
      process.stdout.write(JSON.stringify({ validStatus: valid.statusCode, rejects }));
    `);
    expect(result.validStatus).toBe(201);
    for (const reject of result.rejects) {
      expect(reject.status).toBe(400);
    }
  });
});
