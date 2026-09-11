const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Disposable credentials and an isolated data directory: nothing here
// touches production data or real secrets.
const TEST_API_KEY = 'x'.repeat(64);
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-transaction-'));
process.env.OBD_API_KEY = TEST_API_KEY;
process.env.OBD_DATA_DIR = TEST_DATA_DIR;
process.env.OBD_INITIAL_ADMIN_PASSWORD = 'TransactionTestPass123!';
process.env.NODE_ENV = 'test';

const SERVER_FILE = path.join(__dirname, 'server.js');

let backend;
let fastify;
const auth = { 'x-api-key': TEST_API_KEY };

function cookieValue(setCookie) {
  return String(setCookie).split(';')[0];
}

function readDisk(name) {
  const file = path.join(TEST_DATA_DIR, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function journalOnDisk() {
  return fs.existsSync(path.join(TEST_DATA_DIR, 'txn_journal.json'));
}

function orphanStaging() {
  return fs.readdirSync(TEST_DATA_DIR).filter(name => /\.txn\.txn_[^.]+\.tmp$/.test(name));
}

// Restart probe: a fresh process requiring server.js runs startup recovery
// BEFORE loading stores, then reports disk + memory state. This simulates a
// crash/restart after a mid-commit failure.
function restartProbe(dataDir) {
  const probe = `
    process.env.OBD_API_KEY = ${JSON.stringify(TEST_API_KEY)};
    process.env.OBD_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.OBD_INITIAL_ADMIN_PASSWORD = 'TransactionTestPass123!';
    process.env.NODE_ENV = 'test';
    const backend = require(${JSON.stringify(SERVER_FILE)});
    const fs = require('fs');
    const path = require('path');
    const dir = process.env.OBD_DATA_DIR;
    const read = (name) => {
      const file = path.join(dir, name);
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    };
    const report = {
      journalExists: fs.existsSync(path.join(dir, 'txn_journal.json')),
      orphans: fs.readdirSync(dir).filter(n => /\\.txn\\.txn_[^.]+\\.tmp$/.test(n)),
      diskTelemetry: (read('telemetry.json') || []).map(r => r.vehicleId),
      diskFuel: (read('fuel_logs.json') || []).map(r => r.vehicleId),
      diskVehicles: (read('vehicles.json') || []).map(v => v.id),
      diskDevices: (read('devices.json') || []).map(d => d.id),
      memoryTelemetry: backend.telemetryDataStore.map(r => r.vehicleId),
      memoryVehicles: backend.vehiclesStore.map(v => v.id),
    };
    process.stdout.write(JSON.stringify(report));
  `;
  const output = execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  return JSON.parse(output);
}

beforeAll(async () => {
  backend = require('./server');
  fastify = backend.fastify;
  await fastify.ready();
});

afterAll(async () => {
  if (fastify) await fastify.close();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test('vehicle delete with reassign rolls back when staging the second file fails', async () => {
  const created = await fastify.inject({
    method: 'POST', url: '/api/vehicles', headers: auth, payload: { name: 'Rollback Car' }
  });
  expect(created.statusCode).toBe(201);
  const doomedId = created.json().id;

  expect((await fastify.inject({
    method: 'POST', url: '/api/telemetry/batch', headers: auth,
    payload: [{ timestamp: 7001, vehicleId: doomedId, eventId: 'rollback-t1', speed: 11 }]
  })).statusCode).toBe(201);
  expect((await fastify.inject({
    method: 'POST', url: '/api/fuel-logs', headers: auth,
    payload: { litres: 5, odometer: 7001, vehicleId: doomedId, eventId: 'rollback-f1' }
  })).statusCode).toBe(201);

  const vehiclesBefore = JSON.stringify(readDisk('vehicles.json'));
  const telemetryBefore = JSON.stringify(readDisk('telemetry.json'));

  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = (file, ...rest) => {
    if (String(file).includes('fuel_logs.json')) throw new Error('simulated staging failure');
    return originalWrite.call(fs, file, ...rest);
  };
  let failed;
  try {
    failed = await fastify.inject({
      method: 'DELETE', url: `/api/vehicles/${doomedId}?reassign=default`, headers: auth
    });
  } finally {
    fs.writeFileSync = originalWrite;
  }
  expect(failed.statusCode).toBe(503);
  expect(failed.json().retryable).toBe(true);

  // Rollback: disk untouched, memory untouched, no journal or orphans.
  expect(JSON.stringify(readDisk('vehicles.json'))).toBe(vehiclesBefore);
  expect(JSON.stringify(readDisk('telemetry.json'))).toBe(telemetryBefore);
  expect(backend.vehiclesStore.some(v => v.id === doomedId)).toBe(true);
  expect(backend.telemetryDataStore.some(r => r.eventId === 'rollback-t1' && r.vehicleId === doomedId)).toBe(true);
  expect(journalOnDisk()).toBe(false);
  expect(orphanStaging()).toEqual([]);

  // Repeated write after the failure succeeds with consistent disk/memory.
  const retried = await fastify.inject({
    method: 'DELETE', url: `/api/vehicles/${doomedId}?reassign=default`, headers: auth
  });
  expect(retried.statusCode).toBe(200);
  expect(backend.vehiclesStore.some(v => v.id === doomedId)).toBe(false);
  expect(readDisk('telemetry.json').filter(r => r.eventId === 'rollback-t1').every(r => r.vehicleId === 'default')).toBe(true);
  expect(readDisk('fuel_logs.json').filter(r => r.eventId === 'rollback-f1').every(r => r.vehicleId === 'default')).toBe(true);
});

test('vehicle creation rolls back when its disk write fails', async () => {
  const vehiclesBefore = readDisk('vehicles.json').length;
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = (file, ...rest) => {
    if (String(file).includes('vehicles.json')) throw new Error('simulated registry failure');
    return originalWrite.call(fs, file, ...rest);
  };
  let failed;
  try {
    failed = await fastify.inject({
      method: 'POST', url: '/api/vehicles', headers: auth, payload: { name: 'Ghost Car' }
    });
  } finally {
    fs.writeFileSync = originalWrite;
  }
  expect(failed.statusCode).toBe(503);
  expect(readDisk('vehicles.json')).toHaveLength(vehiclesBefore);
  expect(backend.vehiclesStore.some(v => v.name === 'Ghost Car')).toBe(false);

  const retried = await fastify.inject({
    method: 'POST', url: '/api/vehicles', headers: auth, payload: { name: 'Ghost Car' }
  });
  expect(retried.statusCode).toBe(201);
});

test('device claim with a new vehicle is atomic and the session stays retryable', async () => {
  const password = backend.hashPassword('ClaimUserPass123!');
  backend.usersStore.push({
    id: 'usr-claim', username: 'claim-user', role: 'user',
    passwordSalt: password.salt, passwordHash: password.hash,
    vehicles: ['default'], mustChangePassword: false
  });
  const login = await fastify.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { username: 'claim-user', password: 'ClaimUserPass123!' }
  });
  expect(login.statusCode).toBe(200);
  const cookie = cookieValue(login.headers['set-cookie']);
  const csrf = login.json().csrfToken;
  const userAuth = { cookie, 'x-csrf-token': csrf };

  const initiated = await fastify.inject({ method: 'POST', url: '/api/auth/device/initiate' });
  expect(initiated.statusCode).toBe(200);
  const pairingCode = initiated.json().pairingCode;

  const vehiclesBefore = JSON.stringify(readDisk('vehicles.json'));
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = (file, ...rest) => {
    if (String(file).includes('users.json')) throw new Error('simulated user-write failure');
    return originalWrite.call(fs, file, ...rest);
  };
  let failed;
  try {
    failed = await fastify.inject({
      method: 'POST', url: '/api/auth/device/claim', headers: userAuth,
      payload: { pairingCode, newVehicleName: 'Claimed Car' }
    });
  } finally {
    fs.writeFileSync = originalWrite;
  }
  expect(failed.statusCode).toBe(503);
  // No orphan vehicle or device on disk; the pairing session is retryable.
  expect(JSON.stringify(readDisk('vehicles.json'))).toBe(vehiclesBefore);
  expect((readDisk('devices.json') || []).some(d => d.vehicleId !== 'default' && d.userId === 'usr-claim')).toBe(false);
  expect(journalOnDisk()).toBe(false);

  const retried = await fastify.inject({
    method: 'POST', url: '/api/auth/device/claim', headers: userAuth,
    payload: { pairingCode, newVehicleName: 'Claimed Car' }
  });
  expect(retried.statusCode).toBe(200);
  expect(retried.json().deviceToken).toMatch(/^obd_dev_/);
  const claimedVehicle = retried.json().vehicleId;
  expect(backend.vehiclesStore.some(v => v.id === claimedVehicle)).toBe(true);
  expect(readDisk('vehicles.json').some(v => v.id === claimedVehicle)).toBe(true);

  // The pairing code is single-use: reusing it after approval is rejected.
  const replay = await fastify.inject({
    method: 'POST', url: '/api/auth/device/claim', headers: userAuth,
    payload: { pairingCode, newVehicleName: 'Claimed Car' }
  });
  expect(replay.statusCode).toBe(404);
});

test('device revocation persists the token removal', async () => {
  const initiated = await fastify.inject({ method: 'POST', url: '/api/auth/device/initiate' });
  const claim = await fastify.inject({
    method: 'POST', url: '/api/auth/device/claim', headers: auth,
    payload: { pairingCode: initiated.json().pairingCode, vehicleId: 'default' }
  });
  expect(claim.statusCode).toBe(200);
  const deviceId = claim.json().deviceId;
  expect(readDisk('devices.json').some(d => d.id === deviceId)).toBe(true);

  const revoked = await fastify.inject({
    method: 'DELETE', url: `/api/devices/${deviceId}`, headers: auth
  });
  expect(revoked.statusCode).toBe(200);
  expect(backend.devicesStore.some(d => d.id === deviceId)).toBe(false);
  expect(readDisk('devices.json').some(d => d.id === deviceId)).toBe(false);

  const afterRestart = restartProbe(TEST_DATA_DIR);
  expect(afterRestart.diskDevices.includes(deviceId)).toBe(false);
});

test('mixed concurrent mutations serialize without lost updates', async () => {
  const batch = (eventId) => fastify.inject({
    method: 'POST', url: '/api/telemetry/batch', headers: auth,
    payload: [{ timestamp: 8000, eventId, speed: 5 }]
  });
  const responses = await Promise.all([
    ...Array.from({ length: 10 }, (_, i) => batch(`mixed-${i}`)),
    ...Array.from({ length: 5 }, (_, i) => fastify.inject({
      method: 'POST', url: '/api/vehicles', headers: auth, payload: { name: `Mixed Car ${i}` }
    })),
  ]);
  expect(responses.every(r => r.statusCode === 201)).toBe(true);
  const sequences = backend.telemetryDataStore.filter(r => /^mixed-/.test(r.eventId)).map(r => r.ingestSeq);
  expect(new Set(sequences).size).toBe(10);
  expect(backend.vehiclesStore.filter(v => /^Mixed Car /.test(v.name))).toHaveLength(5);
});

test('command enqueue cannot race a telemetry command drain into resurrecting a delivered command', async () => {
  let writeStartedResolver;
  const writeStartedPromise = new Promise(resolve => { writeStartedResolver = resolve; });
  let releaseWriteResolver;
  const releaseWritePromise = new Promise(resolve => { releaseWriteResolver = resolve; });

  const originalWriteFile = fs.promises.writeFile;
  let intercepted = false;
  fs.promises.writeFile = async (file, data, options) => {
    if (!intercepted && String(file).includes('commands_queue.json')) {
      intercepted = true;
      writeStartedResolver();
      await releaseWritePromise;
    }
    return originalWriteFile.call(fs.promises, file, data, options);
  };

  try {
    const enqueuePromise = fastify.inject({
      method: 'POST', url: '/api/commands', headers: auth,
      payload: { command: 'clear_dtc', vehicleId: 'default' }
    });

    await writeStartedPromise;

    const telemetryPromise = fastify.inject({
      method: 'POST', url: '/api/telemetry/batch', headers: auth,
      payload: [{ timestamp: 8888, vehicleId: 'default', eventId: 'race-drain-t1', speed: 22 }]
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    releaseWriteResolver();

    const [enqueueRes, telemetryRes] = await Promise.all([enqueuePromise, telemetryPromise]);
    expect(enqueueRes.statusCode).toBe(200);
    expect(telemetryRes.statusCode).toBe(201);
    expect(telemetryRes.json().commands).toEqual(['clear_dtc']);

    const diskQueue = readDisk('commands_queue.json') || [];
    expect(diskQueue).toEqual([]);
    expect(backend.getPendingCommands()).toEqual([]);

    const diskQueueAfterRestart = readDiskAfterRestart(TEST_DATA_DIR, 'commands_queue.json') || [];
    expect(diskQueueAfterRestart).toEqual([]);
  } finally {
    fs.promises.writeFile = originalWriteFile;
  }
});

test('single-file persist failure before rename leaves the process usable, while directory fsync failure after rename poisons it', async () => {
  backend._resetPoisonStateForTesting();

  // Part 1: Pre-rename failure (e.g. write error) is clean, retryable, and does not poison.
  const originalWriteFile = fs.promises.writeFile;
  let preWriteFailed = false;
  fs.promises.writeFile = async (file, ...args) => {
    if (!preWriteFailed && String(file).includes('fuel_logs.json')) {
      preWriteFailed = true;
      throw new Error('simulated pre-rename write failure');
    }
    return originalWriteFile.call(fs.promises, file, ...args);
  };

  try {
    const failedPre = await fastify.inject({
      method: 'POST', url: '/api/fuel-logs', headers: auth,
      payload: { litres: 12, odometer: 8500, vehicleId: 'default', eventId: 'persist-pre-fail-1' }
    });
    expect(failedPre.statusCode).toBe(503);
    expect(failedPre.json().retryable).toBe(true);
    expect(backend.isPoisoned()).toBe(false);

    // Temp file cleaned up
    const orphanTmps = fs.readdirSync(TEST_DATA_DIR).filter(f => f.includes('fuel_logs.json.tmp'));
    expect(orphanTmps).toHaveLength(0);

    // Retrying succeeds
    const retryPre = await fastify.inject({
      method: 'POST', url: '/api/fuel-logs', headers: auth,
      payload: { litres: 12, odometer: 8500, vehicleId: 'default', eventId: 'persist-pre-fail-1' }
    });
    expect(retryPre.statusCode).toBe(201);
    expect(backend.isPoisoned()).toBe(false);
  } finally {
    fs.promises.writeFile = originalWriteFile;
  }

  // Part 2: Post-rename failure (e.g. parent directory sync on Linux) poisons the process.
  const originalOpen = fs.promises.open;
  let dirSyncFailed = false;
  fs.promises.open = async (p, flags, mode) => {
    if (!dirSyncFailed && p === TEST_DATA_DIR) {
      dirSyncFailed = true;
      throw new Error('simulated post-rename directory sync failure');
    }
    return originalOpen.call(fs.promises, p, flags, mode);
  };

  try {
    const failedPost = await fastify.inject({
      method: 'POST', url: '/api/fuel-logs', headers: auth,
      payload: { litres: 14, odometer: 8600, vehicleId: 'default', eventId: 'persist-post-fail-1' }
    });
    expect(failedPost.statusCode).toBe(503);
    expect(dirSyncFailed).toBe(true);
    expect(backend.isPoisoned()).toBe(true);

    // Subsequent read is rejected
    const readRejected = await fastify.inject({
      method: 'GET', url: '/api/fuel-logs', headers: auth
    });
    expect(readRejected.statusCode).toBe(503);
    expect(readRejected.json().retryable).toBe(false);

    // Subsequent write is rejected
    const writeRejected = await fastify.inject({
      method: 'POST', url: '/api/fuel-logs', headers: auth,
      payload: { litres: 16, odometer: 8700, vehicleId: 'default', eventId: 'persist-post-fail-2' }
    });
    expect(writeRejected.statusCode).toBe(503);
    expect(writeRejected.json().retryable).toBe(false);
  } finally {
    fs.promises.open = originalOpen;
    backend._resetPoisonStateForTesting();
  }
});

test('a failed transaction commit poisons all later HTTP reads and writes and preserves the COMMITTING journal', async () => {
  backend._resetPoisonStateForTesting();
  const created = await fastify.inject({
    method: 'POST', url: '/api/vehicles', headers: auth, payload: { name: 'Crash Car' }
  });
  expect(created.statusCode).toBe(201);
  const crashId = created.json().id;

  expect((await fastify.inject({
    method: 'POST', url: '/api/telemetry/batch', headers: auth,
    payload: [{ timestamp: 9001, vehicleId: crashId, eventId: 'crash-t1', speed: 7 }]
  })).statusCode).toBe(201);
  expect((await fastify.inject({
    method: 'POST', url: '/api/fuel-logs', headers: auth,
    payload: { litres: 9, odometer: 9001, vehicleId: crashId, eventId: 'crash-f1' }
  })).statusCode).toBe(201);

  // Fail the second commit rename (fuel file): telemetry is already moved on
  // disk while memory still associates it with the old vehicle.
  const originalRenameSync = fs.renameSync;
  let injected = false;
  fs.renameSync = (from, to, ...rest) => {
    if (!injected && String(to).endsWith('fuel_logs.json')) {
      injected = true;
      throw new Error('simulated crash mid-commit');
    }
    return originalRenameSync.call(fs, from, to, ...rest);
  };
  let failed;
  try {
    failed = await fastify.inject({
      method: 'DELETE', url: `/api/vehicles/${crashId}?reassign=default`, headers: auth
    });
  } finally {
    fs.renameSync = originalRenameSync;
  }
  expect(injected).toBe(true);
  expect(failed.statusCode).toBe(503);
  expect(failed.json().retryable).toBe(true);
  // Process is poisoned after uncertain COMMITTING failure
  expect(backend.isPoisoned()).toBe(true);
  // Memory is untouched by the failed commit.
  expect(backend.vehiclesStore.some(v => v.id === crashId)).toBe(true);
  // The COMMITTING journal survives for startup recovery.
  expect(journalOnDisk()).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'txn_journal.json'), 'utf8')).state).toBe('COMMITTING');

  // Verify journal poisoning: subsequent read and write requests without restarting
  // are rejected (fail-closed) and DO NOT overwrite or delete the journal.
  const subsequentReads = await Promise.all([
    fastify.inject({ method: 'GET', url: '/api/vehicles', headers: auth }),
    fastify.inject({ method: 'GET', url: '/api/telemetry', headers: auth }),
    fastify.inject({ method: 'GET', url: '/api/fuel-logs', headers: auth })
  ]);
  for (const readRes of subsequentReads) {
    expect(readRes.statusCode).toBe(503);
    expect(readRes.json().retryable).toBe(false);
    expect(readRes.json().poisoned).toBe(true);
  }

  const subsequentWrites = await Promise.all([
    fastify.inject({ method: 'POST', url: '/api/vehicles', headers: auth, payload: { name: 'Forbidden Second Car' } }),
    fastify.inject({ method: 'POST', url: '/api/commands', headers: auth, payload: { command: 'read_dtc' } }),
    fastify.inject({ method: 'POST', url: '/api/telemetry/batch', headers: auth, payload: [{ timestamp: 9999, speed: 0 }] })
  ]);
  for (const writeRes of subsequentWrites) {
    expect(writeRes.statusCode).toBe(503);
    expect(writeRes.json().retryable).toBe(false);
    expect(writeRes.json().poisoned).toBe(true);
  }

  // Journal is still intact and not replaced by the subsequent write attempts
  expect(journalOnDisk()).toBe(true);
  const journalContent = JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, 'txn_journal.json'), 'utf8'));
  expect(journalContent.state).toBe('COMMITTING');
  expect((readDisk('vehicles.json') || []).some(v => v.name === 'Forbidden Second Car')).toBe(false);

  // Restart: recovery rolls the transaction forward, then loads consistent
  // disk state into memory.
  const afterRestart = restartProbe(TEST_DATA_DIR);
  expect(afterRestart.journalExists).toBe(false);
  expect(afterRestart.orphans).toEqual([]);
  expect(afterRestart.diskVehicles.includes(crashId)).toBe(false);
  expect(afterRestart.memoryVehicles.includes(crashId)).toBe(false);
  const diskTelemetry = readDiskAfterRestart(dataDirOf(TEST_DATA_DIR), 'telemetry.json');
  expect(diskTelemetry.filter(r => r.eventId === 'crash-t1').every(r => r.vehicleId === 'default')).toBe(true);
  expect(afterRestart.diskFuel.filter(id => id === crashId)).toEqual([]);
  expect(afterRestart.memoryTelemetry.filter(id => id === crashId)).toEqual([]);
});

function dataDirOf(dir) {
  return dir;
}

function readDiskAfterRestart(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

test('a PREPARED journal with no commit rolls back on startup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-txn-prepared-'));
  try {
    const journal = {
      id: 'txn_1234_abcd',
      state: 'PREPARED',
      files: [path.join(dir, 'telemetry.json')],
      createdAt: Date.now()
    };
    fs.writeFileSync(path.join(dir, 'txn_journal.json'), JSON.stringify(journal));
    fs.writeFileSync(path.join(dir, 'telemetry.json.txn.txn_1234_abcd.tmp'), JSON.stringify([{ stale: true }]));
    fs.writeFileSync(path.join(dir, 'telemetry.json'), JSON.stringify([{ vehicleId: 'default', eventId: 'kept' }]));

    const probe = `
      process.env.OBD_API_KEY = ${JSON.stringify(TEST_API_KEY)};
      process.env.OBD_DATA_DIR = ${JSON.stringify(dir)};
      process.env.OBD_INITIAL_ADMIN_PASSWORD = 'TransactionTestPass123!';
      process.env.NODE_ENV = 'test';
      require(${JSON.stringify(SERVER_FILE)});
      process.stdout.write('recovered');
    `;
    const output = execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
    expect(output).toBe('recovered');
    expect(fs.existsSync(path.join(dir, 'txn_journal.json'))).toBe(false);
    expect(fs.readdirSync(dir).filter(n => n.includes('.txn.'))).toEqual([]);
    // Rollback restores the pre-commit content (startup may add durable
    // ingestSeq values via its own migration; identity must be intact).
    const restored = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8'));
    expect(restored.map(r => [r.vehicleId, r.eventId])).toEqual([['default', 'kept']]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt journal fails closed instead of serving half-committed data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-txn-corrupt-'));
  try {
    fs.writeFileSync(path.join(dir, 'txn_journal.json'), '{not valid json');
    const probe = `
      process.env.OBD_API_KEY = ${JSON.stringify(TEST_API_KEY)};
      process.env.OBD_DATA_DIR = ${JSON.stringify(dir)};
      process.env.OBD_INITIAL_ADMIN_PASSWORD = 'TransactionTestPass123!';
      process.env.NODE_ENV = 'test';
      require(${JSON.stringify(SERVER_FILE)});
    `;
    let exitCode = 0;
    try {
      execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      exitCode = err.status;
    }
    expect(exitCode).not.toBe(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
