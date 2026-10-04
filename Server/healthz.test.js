const os = require('os');
const path = require('path');
const fs = require('fs');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-healthz-'));
process.env.OBD_DATA_DIR = TEST_DATA_DIR;
const TEST_API_KEY = 'a'.repeat(64);
process.env.OBD_API_KEY = TEST_API_KEY;
const { fastify } = require('./server');

describe('GET /healthz', () => {
  afterAll(async () => {
    await fastify.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('returns 200 with build identity and store sizes', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('obd-telemetry-server');
    expect(typeof body.version).toBe('string');
    expect(typeof body.build_commit).toBe('string');
    expect(typeof body.build_time).toBe('string');
    expect(typeof body.uptime_seconds).toBe('number');
    expect(typeof body.telemetry_records).toBe('number');
    // The response must NEVER include the API key, even by
    // accident. Test by stringifying the whole body and
    // asserting the test key is absent.
    expect(response.payload).not.toContain(TEST_API_KEY);
  });

  it('reports deployment identity and real elapsed uptime', async () => {
    const before = {
      version: process.env.OBD_SERVICE_VERSION,
      commit: process.env.OBD_BUILD_COMMIT,
      time: process.env.OBD_BUILD_TIME
    };
    process.env.OBD_SERVICE_VERSION = 'test-release';
    process.env.OBD_BUILD_COMMIT = 'test-commit';
    process.env.OBD_BUILD_TIME = '2026-10-04T00:00:00Z';
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60000);
    try {
      const response = await fastify.inject({ method: 'GET', url: '/healthz' });
      expect(response.json()).toMatchObject({
        version: 'test-release', build_commit: 'test-commit', build_time: '2026-10-04T00:00:00Z'
      });
      expect(response.json().uptime_seconds).toBeGreaterThanOrEqual(60);
    } finally {
      clock.mockRestore();
      for (const [key, value] of Object.entries({
        OBD_SERVICE_VERSION: before.version, OBD_BUILD_COMMIT: before.commit, OBD_BUILD_TIME: before.time
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
