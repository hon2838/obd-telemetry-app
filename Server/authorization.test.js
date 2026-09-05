const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TEST_API_KEY = 'a'.repeat(64);
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-authz-'));
process.env.OBD_API_KEY = TEST_API_KEY;
process.env.OBD_DATA_DIR = TEST_DATA_DIR;

const {
  fastify,
  usersStore,
  vehiclesStore,
  devicesStore,
  telemetryDataStore,
  fuelLogsStore,
  maintenanceStore,
  hashPassword,
  migrateDeviceTokensAtRest,
  DEVICES_PATH,
  DEFAULT_VEHICLE_ID
} = require('./server');

describe('Backend Security & Authorization Acceptance Tests', () => {
  const MASTER_AUTH = { 'x-api-key': TEST_API_KEY };
  let user1Session = '';
  let user2Session = '';
  let userMustResetSession = '';
  let multiVehicleSession = '';

  beforeAll(async () => {
    await fastify.ready();

    // Create 2 test users with known passwords
    // User 1: owns veh-alice
    const u1Hash = hashPassword('AlicePass123!');
    usersStore.push({
      id: 'usr-alice',
      username: 'alice',
      role: 'user',
      passwordSalt: u1Hash.salt,
      passwordHash: u1Hash.hash,
      vehicles: ['veh-alice'],
      mustChangePassword: false,
      createdAt: Date.now()
    });

    // User 2: owns veh-bob
    const u2Hash = hashPassword('BobPass123!');
    usersStore.push({
      id: 'usr-bob',
      username: 'bob',
      role: 'user',
      passwordSalt: u2Hash.salt,
      passwordHash: u2Hash.hash,
      vehicles: ['veh-bob'],
      mustChangePassword: false,
      createdAt: Date.now()
    });

    // User 3: must change password
    const u3Hash = hashPassword('ResetPass123!');
    usersStore.push({
      id: 'usr-reset',
      username: 'resetuser',
      role: 'user',
      passwordSalt: u3Hash.salt,
      passwordHash: u3Hash.hash,
      vehicles: ['veh-alice'],
      mustChangePassword: true,
      createdAt: Date.now()
    });

    const multiHash = hashPassword('MultiPass123!');
    usersStore.push({
      id: 'usr-multi',
      username: 'multi',
      role: 'user',
      passwordSalt: multiHash.salt,
      passwordHash: multiHash.hash,
      vehicles: ['veh-alice', 'veh-bob'],
      mustChangePassword: false,
      createdAt: Date.now()
    });

    // Create vehicles
    vehiclesStore.push(
      { id: 'veh-alice', name: "Alice's Car", createdAt: Date.now() },
      { id: 'veh-bob', name: "Bob's Car", createdAt: Date.now() }
    );

    // Login user 1
    const res1 = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'AlicePass123!' }
    });
    user1Session = res1.json().token;

    // Login user 2
    const res2 = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'bob', password: 'BobPass123!' }
    });
    user2Session = res2.json().token;

    // Login user 3
    const res3 = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'resetuser', password: 'ResetPass123!' }
    });
    userMustResetSession = res3.json().token;

    const multiRes = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'multi', password: 'MultiPass123!' }
    });
    multiVehicleSession = multiRes.json().token;
  });

  afterAll(async () => {
    await fastify.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  // 1. Default-deny on all protected endpoints for anonymous/invalid credentials (401)
  test('1. Default-deny on all protected endpoints for anonymous or invalid credentials', async () => {
    const protectedUrls = [
      { method: 'GET', url: '/api/telemetry/latest' },
      { method: 'GET', url: '/api/telemetry/history' },
      { method: 'POST', url: '/api/telemetry/batch', payload: [] },
      { method: 'GET', url: '/api/vehicles' },
      { method: 'POST', url: '/api/vehicles', payload: { name: 'X' } },
      { method: 'GET', url: '/api/fuel-logs' },
      { method: 'POST', url: '/api/fuel-logs', payload: { litres: 10, odometer: 100 } },
      { method: 'GET', url: '/api/maintenance' },
      { method: 'POST', url: '/api/commands', payload: { command: 'read_dtc' } },
      { method: 'GET', url: '/api/devices' },
      { method: 'POST', url: '/api/auth/device/claim', payload: { pairingCode: '123456', vehicleId: 'default' } },
    ];

    for (const req of protectedUrls) {
      // Anonymous
      const anonRes = await fastify.inject({ method: req.method, url: req.url, payload: req.payload });
      expect(anonRes.statusCode).toBe(401);

      // Invalid token
      const badTokenRes = await fastify.inject({
        method: req.method,
        url: req.url,
        payload: req.payload,
        headers: { authorization: 'Bearer invalid-token-xyz' }
      });
      expect(badTokenRes.statusCode).toBe(401);

      // Invalid API Key
      const badKeyRes = await fastify.inject({
        method: req.method,
        url: req.url,
        payload: req.payload,
        headers: { 'x-api-key': 'x'.repeat(64) }
      });
      expect(badKeyRes.statusCode).toBe(401);
    }
  });

  // 2. Public endpoints accessible without auth
  test('2. Public endpoints accessible without auth', async () => {
    const healthz = await fastify.inject({ method: 'GET', url: '/healthz' });
    expect(healthz.statusCode).toBe(200);

    const install = await fastify.inject({ method: 'GET', url: '/install.sh' });
    expect(install.statusCode).toBe(200);

    const agentLatest = await fastify.inject({ method: 'GET', url: '/api/agent/latest' });
    // Either 200 or 404 if no APK baked, but not 401
    expect([200, 404]).toContain(agentLatest.statusCode);

    const deviceInitiate = await fastify.inject({ method: 'POST', url: '/api/auth/device/initiate' });
    expect(deviceInitiate.statusCode).toBe(200);
    const initData = deviceInitiate.json();
    expect(initData.pairingCode).toBeDefined();
    expect(initData.pollToken).toBeDefined();

    const devicePoll = await fastify.inject({ method: 'GET', url: `/api/auth/device/poll?token=${initData.pollToken}` });
    expect(devicePoll.statusCode).toBe(200);
    expect(devicePoll.json().status).toBe('pending');
  });

  // 3. Deny anonymous mutations: fuel create/delete, maintenance edit/delete, DTC ingestion, device revocation
  test('3. Deny anonymous fuel, maintenance, DTC, and device mutations', async () => {
    expect((await fastify.inject({ method: 'POST', url: '/api/fuel-logs', payload: { litres: 10, odometer: 100 } })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'DELETE', url: '/api/fuel-logs/123' })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'POST', url: '/api/maintenance', payload: { name: 'Oil' } })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'PUT', url: '/api/maintenance/123', payload: { name: 'Oil New' } })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'DELETE', url: '/api/maintenance/123' })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'POST', url: '/api/telemetry/dtc', payload: { dtc: 'P0100' } })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'POST', url: '/api/telemetry/dtc/clear', payload: { success: true } })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'POST', url: '/api/dtc', payload: { dtc: 'P0100' } })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'POST', url: '/api/dtc/clear', payload: { success: true } })).statusCode).toBe(401);
    expect((await fastify.inject({ method: 'DELETE', url: '/api/devices/dev-123' })).statusCode).toBe(401);
  });

  // 4. Two ordinary users and two vehicles: explicit & omitted ?vehicle= queries, mutations, drive exports (zero cross-user access)
  test('4. Two ordinary users with strict vehicle isolation', async () => {
    const user1Headers = { authorization: `Bearer ${user1Session}` };
    const user2Headers = { authorization: `Bearer ${user2Session}` };

    // Ingest data for both vehicles using master key
    telemetryDataStore.push(
      { timestamp: 1000, vehicleId: 'veh-alice', speed: 50, latitude: 3.1, longitude: 101.6, receivedAt: 1000 },
      { timestamp: 2000, vehicleId: 'veh-bob', speed: 60, latitude: 3.2, longitude: 101.7, receivedAt: 2000 }
    );
    fuelLogsStore.push(
      { id: 'f-alice', vehicleId: 'veh-alice', timestamp: 1000, litres: 30, odometer: 1000, source: 'web' },
      { id: 'f-bob', vehicleId: 'veh-bob', timestamp: 2000, litres: 40, odometer: 2000, source: 'web' }
    );
    maintenanceStore.push(
      { id: 'm-alice', vehicleId: 'veh-alice', name: 'Alice Oil', intervalKm: 5000, createdAt: 1000, updatedAt: 1000 },
      { id: 'm-bob', vehicleId: 'veh-bob', name: 'Bob Oil', intervalKm: 5000, createdAt: 2000, updatedAt: 2000 }
    );

    // Alice queries /api/vehicles: sees only veh-alice
    const aliceVehicles = await fastify.inject({ method: 'GET', url: '/api/vehicles', headers: user1Headers });
    expect(aliceVehicles.statusCode).toBe(200);
    expect(aliceVehicles.json().map(v => v.id)).toEqual(['veh-alice']);

    // Bob queries /api/vehicles: sees only veh-bob
    const bobVehicles = await fastify.inject({ method: 'GET', url: '/api/vehicles', headers: user2Headers });
    expect(bobVehicles.statusCode).toBe(200);
    expect(bobVehicles.json().map(v => v.id)).toEqual(['veh-bob']);

    // Alice queries telemetry without ?vehicle: sees only Alice's records
    const aliceTelem = await fastify.inject({ method: 'GET', url: '/api/telemetry/history', headers: user1Headers });
    expect(aliceTelem.statusCode).toBe(200);
    expect(aliceTelem.json().every(r => r.vehicleId === 'veh-alice')).toBe(true);

    // Alice queries Bob's vehicle (?vehicle=veh-bob): returns 403 Forbidden
    const crossTelem = await fastify.inject({ method: 'GET', url: '/api/telemetry/history?vehicle=veh-bob', headers: user1Headers });
    expect(crossTelem.statusCode).toBe(403);

    const crossFuel = await fastify.inject({ method: 'GET', url: '/api/fuel-logs?vehicle=veh-bob', headers: user1Headers });
    expect(crossFuel.statusCode).toBe(403);

    const crossMaint = await fastify.inject({ method: 'GET', url: '/api/maintenance?vehicle=veh-bob', headers: user1Headers });
    expect(crossMaint.statusCode).toBe(403);

    // Alice tries to mutate Bob's maintenance item: returns 403
    const crossEditMaint = await fastify.inject({
      method: 'PUT',
      url: '/api/maintenance/m-bob',
      headers: user1Headers,
      payload: { name: 'Hacked' }
    });
    expect(crossEditMaint.statusCode).toBe(403);

    // Alice tries to delete Bob's fuel log: returns 403
    const crossDeleteFuel = await fastify.inject({
      method: 'DELETE',
      url: '/api/fuel-logs/f-bob',
      headers: user1Headers
    });
    expect(crossDeleteFuel.statusCode).toBe(403);
  });

  test('4b. Omitted vehicle IDs resolve only for a single-vehicle user', async () => {
    const aliceHeaders = { authorization: `Bearer ${user1Session}` };
    const multiHeaders = { authorization: `Bearer ${multiVehicleSession}` };
    const timestamp = Date.now();

    const telemetry = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: aliceHeaders,
      payload: [{ timestamp, speed: 42 }]
    });
    expect(telemetry.statusCode).toBe(201);
    expect(telemetryDataStore.find(r => r.timestamp === timestamp)?.vehicleId).toBe('veh-alice');

    const fuel = await fastify.inject({
      method: 'POST',
      url: '/api/fuel-logs',
      headers: aliceHeaders,
      payload: { timestamp, litres: 20, odometer: 1234 }
    });
    expect(fuel.statusCode).toBe(201);
    expect(fuelLogsStore.find(r => r.timestamp === timestamp)?.vehicleId).toBe('veh-alice');

    const maintenance = await fastify.inject({
      method: 'POST',
      url: '/api/maintenance',
      headers: aliceHeaders,
      payload: { name: 'Single vehicle inference', intervalKm: 5000 }
    });
    expect(maintenance.statusCode).toBe(201);
    expect(maintenanceStore.find(r => r.name === 'Single vehicle inference')?.vehicleId).toBe('veh-alice');

    const command = await fastify.inject({
      method: 'POST',
      url: '/api/commands',
      headers: aliceHeaders,
      payload: { command: 'read_dtc' }
    });
    expect(command.statusCode).toBe(200);

    const commandDelivery = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: aliceHeaders,
      payload: [{ timestamp: timestamp + 1, speed: 43 }]
    });
    expect(commandDelivery.json().commands).toContain('read_dtc');

    for (const request of [
      { url: '/api/telemetry/batch', payload: [{ timestamp: timestamp + 2, speed: 44 }] },
      { url: '/api/fuel-logs', payload: { litres: 21, odometer: 1250 } },
      { url: '/api/maintenance', payload: { name: 'Ambiguous vehicle' } },
      { url: '/api/commands', payload: { command: 'read_dtc' } }
    ]) {
      const response = await fastify.inject({
        method: 'POST',
        url: request.url,
        headers: multiHeaders,
        payload: request.payload
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/vehicleId is required/);
    }
  });

  test('4c. A master-key login creates a master bearer session', async () => {
    const login = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: TEST_API_KEY }
    });
    expect(login.statusCode).toBe(200);

    const profile = await fastify.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${login.json().token}` }
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      id: 'master',
      username: 'master-admin',
      role: 'admin',
      mustChangePassword: false
    });
  });

  // 5. Paired device token uploads only to its vehicle; omitted ID maps to its vehicle; mismatched ID or mixed batch fails atomically with 403
  test('5. Paired device token scoping and atomic batch validation', async () => {
    const rawDevToken = 'devtok_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawDevToken).digest('hex');

    devicesStore.push({
      id: 'dev-alice-unit',
      name: 'Alice Head Unit',
      vehicleId: 'veh-alice',
      userId: 'usr-alice',
      tokenHash,
      tokenPrefix: rawDevToken.slice(0, 12),
      tokenSuffix: rawDevToken.slice(-4),
      createdAt: Date.now()
    });

    const devHeaders = { 'x-device-token': rawDevToken };

    // Valid upload with matching vehicleId
    const validRes = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: devHeaders,
      payload: [{ timestamp: Date.now(), vehicleId: 'veh-alice', speed: 45, latitude: 3.1, longitude: 101.6, gpsSpeed: 45 }]
    });
    expect(validRes.statusCode).toBe(201);

    // Valid upload with omitted vehicleId: maps to device vehicleId
    const omittedRes = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: devHeaders,
      payload: [{ timestamp: Date.now() + 1000, speed: 46, latitude: 3.1, longitude: 101.6, gpsSpeed: 46 }]
    });
    expect(omittedRes.statusCode).toBe(201);
    const lastIngested = telemetryDataStore[telemetryDataStore.length - 1];
    expect(lastIngested.vehicleId).toBe('veh-alice');

    // Mismatched vehicleId in batch: fails with 403
    const mismatchedRes = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: devHeaders,
      payload: [{ timestamp: Date.now() + 2000, vehicleId: 'veh-bob', speed: 50, latitude: 3.2, longitude: 101.7, gpsSpeed: 50 }]
    });
    expect(mismatchedRes.statusCode).toBe(403);

    // Mixed batch (one Alice, one Bob): fails atomically with 403, no records written
    const storeLenBefore = telemetryDataStore.length;
    const mixedRes = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: devHeaders,
      payload: [
        { timestamp: Date.now() + 3000, vehicleId: 'veh-alice', speed: 40, latitude: 3.1, longitude: 101.6, gpsSpeed: 40 },
        { timestamp: Date.now() + 3001, vehicleId: 'veh-bob', speed: 40, latitude: 3.2, longitude: 101.7, gpsSpeed: 40 }
      ]
    });
    expect(mixedRes.statusCode).toBe(403);
    expect(telemetryDataStore.length).toBe(storeLenBefore);
  });

  // 6. Device tokens cannot issue commands (403), mutate vehicles, pair devices, or manage accounts
  test('6. Device tokens restricted from administrative and command actions', async () => {
    const rawDevToken = 'devtok_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawDevToken).digest('hex');

    devicesStore.push({
      id: 'dev-alice-restricted',
      name: 'Alice Unit 2',
      vehicleId: 'veh-alice',
      userId: 'usr-alice',
      tokenHash,
      tokenPrefix: rawDevToken.slice(0, 12),
      tokenSuffix: rawDevToken.slice(-4),
      createdAt: Date.now()
    });

    const devHeaders = { 'x-device-token': rawDevToken };

    // Commands (403)
    const cmdRes = await fastify.inject({
      method: 'POST',
      url: '/api/commands',
      headers: devHeaders,
      payload: { command: 'read_dtc', vehicleId: 'veh-alice' }
    });
    expect(cmdRes.statusCode).toBe(403);

    // Create vehicle (403)
    const vehRes = await fastify.inject({
      method: 'POST',
      url: '/api/vehicles',
      headers: devHeaders,
      payload: { name: 'Device Created Car' }
    });
    expect(vehRes.statusCode).toBe(403);

    // Pair device claim (403)
    const claimRes = await fastify.inject({
      method: 'POST',
      url: '/api/auth/device/claim',
      headers: devHeaders,
      payload: { pairingCode: '999999', vehicleId: 'veh-alice' }
    });
    expect(claimRes.statusCode).toBe(403);

    // Change password / manage accounts (403)
    const pwRes = await fastify.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: devHeaders,
      payload: { newPassword: 'Hacked12345!' }
    });
    expect(pwRes.statusCode).toBe(403);
  });

  // 7. Deleting a vehicle deletes its paired device tokens; recreated vehicle with same ID is inaccessible with old token
  test('7. Vehicle deletion deletes paired device tokens and invalidates old token', async () => {
    // Create temporary vehicle and paired device
    await fastify.inject({
      method: 'POST',
      url: '/api/vehicles',
      headers: MASTER_AUTH,
      payload: { name: 'Temp Car', vehicleId: 'veh-temp' }
    });

    const tempDevToken = 'devtok_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(tempDevToken).digest('hex');
    devicesStore.push({
      id: 'dev-temp',
      name: 'Temp Unit',
      vehicleId: 'veh-temp',
      userId: 'usr-admin',
      tokenHash,
      tokenPrefix: tempDevToken.slice(0, 12),
      tokenSuffix: tempDevToken.slice(-4),
      createdAt: Date.now()
    });

    // Token works before delete
    const beforeDel = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: { 'x-device-token': tempDevToken },
      payload: [{ timestamp: Date.now(), vehicleId: 'veh-temp', speed: 30, latitude: 0, longitude: 0, gpsSpeed: 30 }]
    });
    expect(beforeDel.statusCode).toBe(201);

    // Delete vehicle with reassignment since it owns telemetry data
    const delRes = await fastify.inject({
      method: 'DELETE',
      url: '/api/vehicles/veh-temp?reassign=default',
      headers: MASTER_AUTH
    });
    expect(delRes.statusCode).toBe(200);

    // Device token in store is gone
    expect(devicesStore.some(d => d.vehicleId === 'veh-temp')).toBe(false);

    // Token rejected with 401
    const afterDel = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: { 'x-device-token': tempDevToken },
      payload: [{ timestamp: Date.now(), vehicleId: 'veh-temp', speed: 30, latitude: 0, longitude: 0, gpsSpeed: 30 }]
    });
    expect(afterDel.statusCode).toBe(401);

    // Re-create vehicle with same ID
    await fastify.inject({
      method: 'POST',
      url: '/api/vehicles',
      headers: MASTER_AUTH,
      payload: { name: 'Recreated Temp Car', vehicleId: 'veh-temp' }
    });

    // Old token remains invalid (401)
    const afterRecreate = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: { 'x-device-token': tempDevToken },
      payload: [{ timestamp: Date.now(), vehicleId: 'veh-temp', speed: 30, latitude: 0, longitude: 0, gpsSpeed: 30 }]
    });
    expect(afterRecreate.statusCode).toBe(401);
  });

  // 8. Pairing flow: anonymous claim fails (401); authenticated owner approval and poll succeed; PIN cannot poll; wrong poll returns nothing; replay claim fails (409)
  test('8. Robust pairing flow: authentication, separation of PIN vs poll token, and single-use claim', async () => {
    // 1. Device initiates pairing
    const initRes = await fastify.inject({ method: 'POST', url: '/api/auth/device/initiate' });
    expect(initRes.statusCode).toBe(200);
    const { pairingCode, pollToken } = initRes.json();
    expect(pairingCode).toMatch(/^\d{3}-?\d{3}$/);
    expect(pollToken.length).toBeGreaterThanOrEqual(32);

    // 2. Anonymous claim fails with 401
    const anonClaim = await fastify.inject({
      method: 'POST',
      url: '/api/auth/device/claim',
      payload: { pairingCode, vehicleId: 'veh-alice' }
    });
    expect(anonClaim.statusCode).toBe(401);

    // 3. User attempting to claim a vehicle they do NOT own fails with 403
    const unauthorizedClaim = await fastify.inject({
      method: 'POST',
      url: '/api/auth/device/claim',
      headers: { authorization: `Bearer ${user1Session}` }, // Alice owns veh-alice, not veh-bob
      payload: { pairingCode, vehicleId: 'veh-bob' }
    });
    expect(unauthorizedClaim.statusCode).toBe(403);

    // 4. Polling with PIN instead of pollToken returns 404 (prevents PIN-guessing credential theft)
    const pinPoll = await fastify.inject({
      method: 'GET',
      url: `/api/auth/device/poll?token=${pairingCode}`
    });
    expect(pinPoll.statusCode).toBe(404);

    // 5. Polling with invalid/unknown token returns 404
    const badPoll = await fastify.inject({
      method: 'GET',
      url: '/api/auth/device/poll?token=unknown-poll-token-12345678901234567890'
    });
    expect(badPoll.statusCode).toBe(404);

    // 6. Legitimate owner claims device
    const validClaim = await fastify.inject({
      method: 'POST',
      url: '/api/auth/device/claim',
      headers: { authorization: `Bearer ${user1Session}` },
      payload: { pairingCode, vehicleId: 'veh-alice', deviceName: 'Alice Car Head Unit' }
    });
    expect(validClaim.statusCode).toBe(200);
    expect(validClaim.json().success).toBe(true);

    // 7. Repeated claim of the same code fails (404/409 - code consumed/expired)
    const replayClaim = await fastify.inject({
      method: 'POST',
      url: '/api/auth/device/claim',
      headers: { authorization: `Bearer ${user1Session}` },
      payload: { pairingCode, vehicleId: 'veh-alice' }
    });
    expect([404, 409]).toContain(replayClaim.statusCode);

    // 8. Device polls with its secret poll token: succeeds and returns approved credentials
    const pollSuccess = await fastify.inject({
      method: 'GET',
      url: `/api/auth/device/poll?token=${pollToken}`
    });
    expect(pollSuccess.statusCode).toBe(200);
    const pollResult = pollSuccess.json();
    expect(pollResult.status).toBe('approved');
    expect(pollResult.deviceToken).toBeDefined();
    expect(pollResult.vehicleId).toBe('veh-alice');

    // 9. Subsequent poll cleans up session
    const pollAfter = await fastify.inject({
      method: 'GET',
      url: `/api/auth/device/poll?token=${pollToken}`
    });
    expect(pollAfter.statusCode).toBe(404);
  });

  // 9. Rate limit verification: rapid requests to /api/auth/login or /api/commands return 429 when budget exceeded
  test('9. Rate limiting on sensitive endpoints returns 429 when budget exceeded', async () => {
    // /api/auth/login is limited to 15 / 1 minute
    let hit429 = false;
    for (let i = 0; i < 20; i++) {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '198.51.100.1',
        payload: { username: 'alice', password: 'wrongpassword' }
      });
      if (res.statusCode === 429) {
        hit429 = true;
        break;
      }
    }
    expect(hit429).toBe(true);
  });

  // 10. Session expiry and revocation: logout invalidates session; password change invalidates older sessions
  test('10. Session revocation on logout and password change', async () => {
    // Alice logs in to get a fresh session
    const loginRes = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'AlicePass123!' }
    });
    const sessionToken = loginRes.json().token;

    // Check profile
    const profileBefore = await fastify.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(profileBefore.statusCode).toBe(200);

    // Change password
    const pwRes = await fastify.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { currentPassword: 'AlicePass123!', newPassword: 'AliceBrandNewPass456!' }
    });
    expect(pwRes.statusCode).toBe(200);

    // Old session is now invalidated
    const profileAfterPw = await fastify.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    expect(profileAfterPw.statusCode).toBe(401);

    // Log in with new password
    const loginNew = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'AliceBrandNewPass456!' }
    });
    expect(loginNew.statusCode).toBe(200);
    const newSessionToken = loginNew.json().token;

    // Logout
    const logoutRes = await fastify.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${newSessionToken}` }
    });
    expect(logoutRes.statusCode).toBe(200);

    // Session is now invalidated
    const profileAfterLogout = await fastify.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${newSessionToken}` }
    });
    expect(profileAfterLogout.statusCode).toBe(401);
  });

  // 11. Device token at rest migration preserves authentication and is idempotent
  test('11. Device token at-rest migration hashes tokens and is idempotent', () => {
    const rawPlainToken = 'legacytoken_plain_1234567890abcdef123456';
    const legacyDevice = {
      id: 'dev-legacy-1',
      name: 'Legacy Device',
      vehicleId: 'veh-alice',
      userId: 'usr-alice',
      deviceToken: rawPlainToken,
      createdAt: Date.now()
    };
    devicesStore.push(legacyDevice);

    // Run migration
    migrateDeviceTokensAtRest();

    expect(legacyDevice.deviceToken).toBeUndefined();
    expect(legacyDevice.tokenHash).toBe(crypto.createHash('sha256').update(rawPlainToken).digest('hex'));
    expect(legacyDevice.tokenPrefix).toBe(rawPlainToken.slice(0, 12));
    expect(legacyDevice.tokenSuffix).toBe(rawPlainToken.slice(-4));

    // Run again (idempotent)
    const hashBefore = legacyDevice.tokenHash;
    migrateDeviceTokensAtRest();
    expect(legacyDevice.tokenHash).toBe(hashBefore);
  });

  // 12. mustChangePassword gate returns 403 PASSWORD_CHANGE_REQUIRED on non-whitelisted routes
  test('12. User with mustChangePassword flag is gated from non-whitelisted endpoints', async () => {
    const resetHeaders = { authorization: `Bearer ${userMustResetSession}` };

    // Whitelisted routes work
    const meRes = await fastify.inject({ method: 'GET', url: '/api/auth/me', headers: resetHeaders });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().mustChangePassword).toBe(true);

    // Non-whitelisted routes return 403 with code PASSWORD_CHANGE_REQUIRED
    const telemetryRes = await fastify.inject({ method: 'GET', url: '/api/telemetry/latest', headers: resetHeaders });
    expect(telemetryRes.statusCode).toBe(403);
    expect(telemetryRes.json().code).toBe('PASSWORD_CHANGE_REQUIRED');

    const vehiclesRes = await fastify.inject({ method: 'GET', url: '/api/vehicles', headers: resetHeaders });
    expect(vehiclesRes.statusCode).toBe(403);
    expect(vehiclesRes.json().code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});
