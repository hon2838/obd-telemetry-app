// Tests for the atomic `persist(path, data)` helper. The
// helper is module-internal so we exercise it indirectly by
// checking that the data files it produces are valid JSON
// after concurrent writes (which is the failure mode the
// helper fixes).
const path = require('path');
const fs = require('fs');

const TEST_API_KEY = 'a'.repeat(64);
process.env.OBD_API_KEY = TEST_API_KEY;
const { fastify } = require('./server');

describe('persist helper', () => {
  afterAll(async () => {
    await fastify.close();
  });

  it('produces valid JSON after multiple ingests in quick succession', async () => {
    // Fire a few ingest calls back-to-back. The previous
    // (fire-and-forget) writeFile implementation could leave
    // a torn JSON file if the writes overlapped; persist()
    // serializes them and uses temp+rename, so the file is
    // always parseable.
    for (let i = 0; i < 5; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/api/telemetry/batch',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: [{ timestamp: Date.now() + i, speed: 50, rpm: 2000 }],
      });
    }
    // Give the persist chain a moment to drain.
    await new Promise(r => setTimeout(r, 100));
    const dbPath = path.join(__dirname, 'data', 'telemetry.json');
    expect(fs.existsSync(dbPath)).toBe(true);
    // The important assertion: the file is valid JSON, not torn.
    const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    expect(Array.isArray(parsed)).toBe(true);
  });
});
