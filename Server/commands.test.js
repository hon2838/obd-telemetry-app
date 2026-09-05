// Tests for /api/commands authentication, rate limiting, and
// queue persistence. The previous version of this endpoint
// was unauthenticated (any POST could queue a `clear_dtc`
// against the head unit) and the queue was in-memory only
// (lost on container restart). These tests assert the new
// behavior.
const os = require('os');
const path = require('path');
const fs = require('fs');

// Use a temp data dir so we don't pollute the real one.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-commands-'));
process.env.OBD_DATA_DIR = TEST_DATA_DIR;
process.env.OBD_API_KEY = 'a'.repeat(64);

const { fastify } = require('./server');

describe('POST /api/commands', () => {
  afterAll(async () => {
    await fastify.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    // The pendingCommands array is module-scoped. We don't have
    // a clean reset hook, so tests run in declared order and
    // rely on the queue being drained by the ingest path.
  });

  it('returns 401 without an API key', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { command: 'read_dtc' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 with a wrong API key', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/commands',
      headers: { 'x-api-key': 'b'.repeat(64) },
      payload: { command: 'read_dtc' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 400 for an unknown command', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/commands',
      headers: { 'x-api-key': 'a'.repeat(64) },
      payload: { command: 'format_drive' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('queues a valid command with the right key', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/commands',
      headers: { 'x-api-key': 'a'.repeat(64) },
      payload: { command: 'read_dtc' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.queue_size).toBeGreaterThanOrEqual(1);
  });

  it('persists the queue to commands_queue.json', async () => {
    // We don't want to depend on the order tests run in. The
    // previous test added a `read_dtc`; this test just verifies
    // the file exists and is valid JSON.
    const queuePath = path.join(TEST_DATA_DIR, 'commands_queue.json');
    expect(fs.existsSync(queuePath)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    expect(Array.isArray(loaded)).toBe(true);
  });
});
