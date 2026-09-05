const os = require('os');
const path = require('path');
const fs = require('fs');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-auth-'));
process.env.OBD_DATA_DIR = TEST_DATA_DIR;
process.env.OBD_API_KEY = 'a'.repeat(64);

const { fastify, usersStore, hashPassword } = require('./server');

describe('User Accounts & Device Pairing Authentication', () => {
  beforeAll(() => {
    const admin = usersStore.find(u => u.username === 'admin');
    if (admin) {
      const { salt, hash } = hashPassword('admin12345');
      admin.passwordSalt = salt;
      admin.passwordHash = hash;
      admin.mustChangePassword = true;
    }
  });

  afterAll(async () => {
    await fastify.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  let adminSessionToken = '';
  let pollToken = '';
  let pairingCode = '';
  let pairedDeviceToken = '';

  it('allows default admin user to log in and flags mustChangePassword', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin12345' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.token).toBeDefined();
    expect(body.user.username).toBe('admin');
    expect(body.user.mustChangePassword).toBe(true);
    expect(body.user.vehicles).toContain('default');
    adminSessionToken = body.token;
  });

  it('rejects invalid password on login', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrongpassword' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows admin to change password and clears mustChangePassword', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${adminSessionToken}` },
      payload: { newPassword: 'NewAdminSecretPass123!' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);

    // Verify login with old password fails
    const oldLogin = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin12345' },
    });
    expect(oldLogin.statusCode).toBe(401);

    // Verify login with new password succeeds and mustChangePassword is false
    const newLogin = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'NewAdminSecretPass123!' },
    });
    expect(newLogin.statusCode).toBe(200);
    const newBody = JSON.parse(newLogin.payload);
    expect(newBody.user.mustChangePassword).toBe(false);
    adminSessionToken = newBody.token;
  });

  it('returns current user profile and vehicles from /api/auth/me', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${adminSessionToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.username).toBe('admin');
    expect(body.vehicles).toContain('default');
  });

  it('initiates device pairing session for car head unit', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/auth/device/initiate',
      payload: {
        fingerprint: {
          vin: 'PM2AXIA1234567890',
          btMac: '00:1D:A5:68:90:12',
          androidId: 'car-headunit-uuid-001',
          deviceModel: 'Perodua Axia Headunit Android 10',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.pairingCode).toMatch(/^[0-9]{3}-[0-9]{3}$/);
    expect(body.pollToken).toMatch(/^poll_/);
    expect(body.qrUrl).toContain(body.pairingCode);
    pairingCode = body.pairingCode;
    pollToken = body.pollToken;
  });

  it('polls pending pairing status before approval', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/auth/device/poll?token=${pollToken}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('pending');
  });

  it('claims device with user session and associates vehicle', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/auth/device/claim',
      headers: { authorization: `Bearer ${adminSessionToken}` },
      payload: {
        pairingCode,
        vehicleId: 'default',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.vehicleId).toBe('default');
    expect(body.deviceToken).toMatch(/^obd_dev_/);
    pairedDeviceToken = body.deviceToken;
  });

  it('returns approved status and credentials to polling car head unit', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/auth/device/poll?token=${pollToken}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('approved');
    expect(body.deviceToken).toBe(pairedDeviceToken);
    expect(body.vehicleId).toBe('default');
  });

  it('accepts telemetry ingestion using paired device token', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/telemetry/batch',
      headers: { 'x-device-token': pairedDeviceToken },
      payload: [
        {
          timestamp: Date.now(),
          rpm: 1500,
          speed: 60,
          coolantTemp: 88,
          latitude: 3.139,
          longitude: 101.686,
          altitude: 45,
          gpsSpeed: 60,
        },
      ],
    });
    expect(res.statusCode).toBe(201);
  });

  it('lists registered devices and allows revocation', async () => {
    const listRes = await fastify.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { authorization: `Bearer ${adminSessionToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.payload);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const devId = list[0].id;

    const delRes = await fastify.inject({
      method: 'DELETE',
      url: `/api/devices/${devId}`,
      headers: { authorization: `Bearer ${adminSessionToken}` },
    });
    expect(delRes.statusCode).toBe(200);
  });
});
