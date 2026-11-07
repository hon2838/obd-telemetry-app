const Fastify = require('fastify');
const commandsRoutes = require('./routes/commands');
const { trimTombstones } = commandsRoutes;

describe('command ACK retirement contract', () => {
  let app;
  let queue;
  const oldId = 'retired-command-id-000001';
  beforeEach(async () => {
    const now = Date.now();
    queue = trimTombstones([
      { id: oldId, command: 'clear_dtc', vehicleId: 'car', status: 'completed', createdAt: now - 1000, updatedAt: now - 1000 },
      ...Array.from({ length: 100 }, (_, i) => ({ id: `newer-command-id-${i}`, command: 'read_dtc', vehicleId: 'car', status: 'completed', createdAt: now + i, updatedAt: now + i }))
    ]);
    app = Fastify();
    app.addHook('onRequest', async request => { request.auth = { type: 'device', vehicleId: 'car' }; });
    app.register(commandsRoutes, {
      DEFAULT_VEHICLE_ID: 'car', getPendingCommands: () => queue, setPendingCommands: value => { queue = value; },
      serializeMutation: operation => operation(), persist: async () => {}, vehicleExists: () => true,
      canAccessVehicle: () => true, vehicleScope: () => ['car']
    });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  test('evicted result has an explicit permanent response, not a false acknowledgement', async () => {
    expect(queue).toHaveLength(100);
    expect(queue.some(command => command.id === oldId)).toBe(false);
    const result = await app.inject({ method: 'POST', url: '/api/commands/ack',
      headers: { 'x-obd-command-protocol': '2' }, payload: { id: oldId, status: 'completed', result: { success: true } } });
    expect(result.statusCode).toBe(404);
    expect(result.json()).toMatchObject({ code: 'COMMAND_NOT_FOUND', retryable: false });
    expect(result.json().success).toBeUndefined();
  });

  test('conflicting terminal result requires review while identical retry stays idempotent', async () => {
    const command = queue[0];
    const repeated = await app.inject({ method: 'POST', url: '/api/commands/ack',
      headers: { 'x-obd-command-protocol': '2' }, payload: { id: command.id, status: 'completed' } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().alreadyAcknowledged).toBe(true);
    const conflict = await app.inject({ method: 'POST', url: '/api/commands/ack',
      headers: { 'x-obd-command-protocol': '2' }, payload: { id: command.id, status: 'unknown' } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'COMMAND_ACK_CONFLICT', retryable: false });
  });
});
