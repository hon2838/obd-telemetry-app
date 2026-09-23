const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-command-protocol-'));
const queuePath = path.join(TEST_DATA_DIR, 'commands_queue.json');
const oldTimestamp = Date.now() - 26 * 60 * 60 * 1000;
fs.writeFileSync(queuePath, JSON.stringify([
  'read_dtc',
  { id: 'expired-command-id-1234', command: 'clear_dtc', vehicleId: 'default', status: 'pending', createdAt: oldTimestamp, updatedAt: oldTimestamp }
]));
process.env.OBD_DATA_DIR = TEST_DATA_DIR;
process.env.OBD_API_KEY = 'a'.repeat(64);

const { fastify, devicesStore, vehiclesStore, getPendingCommands } = require('./server');

const API = { 'x-api-key': process.env.OBD_API_KEY };
const V2 = { 'x-obd-command-protocol': '2' };
const carOneToken = 'obd_dev_command_car_one';
const carTwoToken = 'obd_dev_command_car_two';
const deviceHeaders = token => ({ 'x-device-token': token, ...V2 });
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

describe('durable command protocol v2', () => {
  beforeAll(async () => {
    devicesStore.push(
      { id: 'test-device-one', vehicleId: 'default', tokenHash: hashToken(carOneToken) },
      { id: 'test-device-two', vehicleId: 'command-car-two', tokenHash: hashToken(carTwoToken) }
    );
    vehiclesStore.push({ id: 'command-car-two', name: 'Command Car Two' });
  });

  afterAll(async () => {
    await fastify.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('migrates legacy queue entries to stable IDs and exposes expired entries', async () => {
    const migrated = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    const legacy = migrated.find(entry => entry.command === 'read_dtc');
    const expired = migrated.find(entry => entry.id === 'expired-command-id-1234');
    expect(legacy.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(legacy.status).toBe('pending');
    expect(legacy.expiresAt).toBeGreaterThan(legacy.createdAt);
    expect(expired.status).toBe('expired');

    const status = await fastify.inject({ method: 'GET', url: '/api/commands/status?vehicle=default', headers: API });
    expect(status.statusCode).toBe(200);
    expect(status.json().commands.find(command => command.id === expired.id).status).toBe('expired');
    const legacyDrain = await fastify.inject({
      method: 'POST', url: '/api/telemetry/batch', headers: API,
      payload: [{ timestamp: Date.now(), speed: 0 }]
    });
    expect(legacyDrain.json().commands).toEqual(['read_dtc']);
  });

  it('redelivers the same command after a lost poll response and ACK response', async () => {
    const queued = await fastify.inject({
      method: 'POST', url: '/api/commands', headers: API,
      payload: { command: 'read_dtc', vehicleId: 'default' }
    });
    expect(queued.statusCode).toBe(200);

    const v2Sync = async offset => fastify.inject({
      method: 'POST', url: '/api/telemetry/batch', headers: deviceHeaders(carOneToken),
      payload: [{ timestamp: Date.now() + offset, eventId: `lost-response-${offset}`, speed: 0 }]
    });
    const firstSync = await v2Sync(1);
    const retrySync = await v2Sync(2);
    expect(firstSync.statusCode).toBe(201);
    expect(firstSync.json().commands).toHaveLength(1);
    expect(retrySync.json().commands[0].id).toBe(firstSync.json().commands[0].id);
    expect(firstSync.json().commands[0].expiresAt).toBeGreaterThan(Date.now());

    const firstPoll = await fastify.inject({ method: 'GET', url: '/api/commands/pending', headers: deviceHeaders(carOneToken) });
    const retryPoll = await fastify.inject({ method: 'GET', url: '/api/commands/pending', headers: deviceHeaders(carOneToken) });
    expect(firstPoll.statusCode).toBe(200);
    expect(firstPoll.json().commands).toHaveLength(1);
    expect(retryPoll.json().commands[0]).toEqual(firstPoll.json().commands[0]);
    const command = firstPoll.json().commands[0];
    expect(command.expiresAt).toBeGreaterThan(Date.now());

    const ack = { id: command.id, status: 'completed', result: { dtc: 'P0300' } };
    const firstAck = await fastify.inject({ method: 'POST', url: '/api/commands/ack', headers: deviceHeaders(carOneToken), payload: ack });
    const retryAck = await fastify.inject({ method: 'POST', url: '/api/commands/ack', headers: deviceHeaders(carOneToken), payload: ack });
    expect(firstAck.statusCode).toBe(200);
    expect(retryAck.statusCode).toBe(200);
    expect(retryAck.json().alreadyAcknowledged).toBe(true);

    const status = await fastify.inject({ method: 'GET', url: '/api/commands/status?vehicle=default', headers: API });
    const completed = status.json().commands.find(entry => entry.id === command.id);
    expect(completed.status).toBe('completed');
    expect(completed.result).toEqual({ dtc: 'P0300' });
    const diagnostics = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'diagnostics.json'), 'utf8'));
    expect(diagnostics.byVehicle.default.latestDtc.code).toBe('P0300');
    const history = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'dtc_history.json'), 'utf8'));
    expect(history.filter(entry => entry.id === `command-${command.id}`)).toHaveLength(1);
  });

  it('rejects cross-vehicle polling and acknowledgments', async () => {
    const queued = await fastify.inject({
      method: 'POST', url: '/api/commands', headers: API,
      payload: { command: 'clear_dtc', vehicleId: 'default' }
    });
    expect(queued.statusCode).toBe(200);
    const poll = await fastify.inject({ method: 'GET', url: '/api/commands/pending?vehicle=default', headers: deviceHeaders(carTwoToken) });
    expect(poll.statusCode).toBe(403);

    const ownerPoll = await fastify.inject({ method: 'GET', url: '/api/commands/pending', headers: deviceHeaders(carOneToken) });
    const command = ownerPoll.json().commands[0];
    const denied = await fastify.inject({
      method: 'POST', url: '/api/commands/ack', headers: deviceHeaders(carTwoToken),
      payload: { id: command.id, status: 'unknown', result: { reason: 'wrong vehicle' } }
    });
    expect(denied.statusCode).toBe(403);
    const ownerAck = await fastify.inject({
      method: 'POST', url: '/api/commands/ack', headers: deviceHeaders(carOneToken),
      payload: { id: command.id, status: 'unknown', result: { reason: 'test cleanup' } }
    });
    expect(ownerAck.statusCode).toBe(200);
  });

  it('records a completed clear result with its command tombstone and history', async () => {
    const queued = await fastify.inject({ method: 'POST', url: '/api/commands', headers: API, payload: { command: 'clear_dtc' } });
    expect(queued.statusCode).toBe(200);
    const poll = await fastify.inject({ method: 'GET', url: '/api/commands/pending', headers: deviceHeaders(carOneToken) });
    const command = poll.json().commands[0];
    const ack = await fastify.inject({
      method: 'POST', url: '/api/commands/ack', headers: deviceHeaders(carOneToken),
      payload: { id: command.id, status: 'completed', result: { success: true } }
    });
    expect(ack.statusCode).toBe(200);
    const diagnostics = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'diagnostics.json'), 'utf8'));
    expect(diagnostics.byVehicle.default.latestClearStatus.success).toBe(true);
    const history = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'dtc_history.json'), 'utf8'));
    expect(history.filter(entry => entry.id === `command-${command.id}`)).toEqual([
      expect.objectContaining({ type: 'clear', success: true, vehicleId: 'default' })
    ]);
    const status = await fastify.inject({ method: 'GET', url: '/api/commands/status?vehicle=default', headers: API });
    expect(status.json().commands.find(entry => entry.id === command.id).status).toBe('completed');
  });

  it('accepts a durable completed clear acknowledgment after its delivery TTL', async () => {
    const queued = await fastify.inject({ method: 'POST', url: '/api/commands', headers: API, payload: { command: 'clear_dtc' } });
    expect(queued.statusCode).toBe(200);
    const poll = await fastify.inject({ method: 'GET', url: '/api/commands/pending', headers: deviceHeaders(carOneToken) });
    const command = poll.json().commands[0];
    const stored = getPendingCommands().find(entry => entry.id === command.id);
    stored.expiresAt = Date.now() - 1;
    const ack = await fastify.inject({
      method: 'POST', url: '/api/commands/ack', headers: deviceHeaders(carOneToken),
      payload: { id: command.id, status: 'completed', result: { success: true } }
    });
    expect(ack.statusCode).toBe(200);
    const status = await fastify.inject({ method: 'GET', url: '/api/commands/status?vehicle=default', headers: API });
    const completed = status.json().commands.find(entry => entry.id === command.id);
    expect(completed.status).toBe('completed');
    expect(completed.result).toEqual({ success: true, lateAckAfterExpiry: true });
    const history = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'dtc_history.json'), 'utf8'));
    expect(history.filter(entry => entry.id === `command-${command.id}`)).toHaveLength(1);
  });

  it('keeps legacy one-shot delivery compatible and records its unverified outcome', async () => {
    const queued = await fastify.inject({ method: 'POST', url: '/api/commands', headers: API, payload: { command: 'clear_dtc' } });
    expect(queued.statusCode).toBe(200);
    const legacyHeaders = { 'x-device-token': carOneToken };
    const sync = await fastify.inject({
      method: 'POST', url: '/api/telemetry/batch', headers: legacyHeaders,
      payload: [{ timestamp: Date.now(), speed: 0 }]
    });
    expect(sync.statusCode).toBe(201);
    expect(sync.json().commands).toEqual(['clear_dtc']);
    const retry = await fastify.inject({
      method: 'POST', url: '/api/telemetry/batch', headers: legacyHeaders,
      payload: [{ timestamp: Date.now() + 1, speed: 0 }]
    });
    expect(retry.json().commands).toEqual([]);
    const status = await fastify.inject({ method: 'GET', url: '/api/commands/status', headers: API });
    expect(status.json().commands.some(entry => entry.status === 'unknown' && entry.result?.reason === 'legacy_delivery_unacknowledged')).toBe(true);
  });

  it('limits pending commands while allowing completed tombstones outside the cap', async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await fastify.inject({ method: 'POST', url: '/api/commands', headers: API, payload: { command: 'read_dtc' } });
      expect(response.statusCode).toBe(200);
    }
    const full = await fastify.inject({ method: 'POST', url: '/api/commands', headers: API, payload: { command: 'read_dtc' } });
    expect(full.statusCode).toBe(429);

    const pending = await fastify.inject({ method: 'GET', url: '/api/commands/pending', headers: deviceHeaders(carOneToken) });
    const command = pending.json().commands[0];
    const ack = await fastify.inject({
      method: 'POST', url: '/api/commands/ack', headers: deviceHeaders(carOneToken),
      payload: { id: command.id, status: 'completed', result: { dtc: '' } }
    });
    expect(ack.statusCode).toBe(200);
    const accepted = await fastify.inject({ method: 'POST', url: '/api/commands', headers: API, payload: { command: 'clear_dtc' } });
    expect(accepted.statusCode).toBe(200);
  });
});
