// /healthz test. Lives in its own file so it doesn't share
// the afterAll that closes fastify for the rest of the suite.
const TEST_API_KEY = 'a'.repeat(64);
process.env.OBD_API_KEY = TEST_API_KEY;
const { fastify } = require('./server');

describe('GET /healthz', () => {
  afterAll(async () => {
    await fastify.close();
  });

  it('returns 200 with build identity and store sizes', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('obd-telemetry-server');
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime_seconds).toBe('number');
    expect(typeof body.telemetry_records).toBe('number');
    // The response must NEVER include the API key, even by
    // accident. Test by stringifying the whole body and
    // asserting the test key is absent.
    expect(response.payload).not.toContain(TEST_API_KEY);
  });
});
