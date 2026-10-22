const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVER_FILE = path.join(__dirname, 'server.js');
const API_KEY = 's'.repeat(64);

function runServerProbe(dataDir, body) {
  const setup = `
    process.env.OBD_API_KEY = ${JSON.stringify(API_KEY)};
    process.env.OBD_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.OBD_STORAGE_ENGINE = 'sqlite';
    process.env.OBD_INITIAL_ADMIN_PASSWORD = 'CrossStoreTestPass123!';
    process.env.NODE_ENV = 'test';
    const fs = require('fs');
    const path = require('path');
    const backend = require(${JSON.stringify(SERVER_FILE)});
    const fastify = backend.fastify;
    const auth = { 'x-api-key': process.env.OBD_API_KEY };
    (async () => { await fastify.ready(); ${body} })().catch(err => {
      process.stderr.write(String(err.stack || err));
      process.exit(1);
    });
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', setup], { encoding: 'utf8' }));
}

test('SQLite and command queue recover together after a crash between participants', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-sqlite-mixed-'));
  try {
    const first = runServerProbe(dir, `
      const command = await fastify.inject({
        method: 'POST', url: '/api/commands', headers: auth,
        payload: { command: 'read_dtc' }
      });
      if (command.statusCode !== 200) throw new Error(command.body);
      const originalRename = fs.renameSync;
      let injected = false;
      fs.renameSync = (from, to, ...rest) => {
        if (!injected && String(to).endsWith('commands_queue.json') &&
            String(from).includes('.txn.')) {
          injected = true;
          throw new Error('simulated crash after SQLite commit');
        }
        return originalRename.call(fs, from, to, ...rest);
      };
      const ingest = await fastify.inject({
        method: 'POST', url: '/api/telemetry/batch', headers: auth,
        payload: [{ timestamp: Date.now(), eventId: 'mixed-crash-1', speed: 25 }]
      });
      fs.renameSync = originalRename;
      process.stdout.write(JSON.stringify({
        status: ingest.statusCode,
        injected,
        poisoned: backend.isPoisoned(),
        dbCount: backend.sqliteStorage.count(),
        journal: fs.existsSync(path.join(process.env.OBD_DATA_DIR, 'txn_journal.json'))
      }));
      process.exit(0);
    `);
    expect(first).toEqual({ status: 503, injected: true, poisoned: true, dbCount: 1, journal: true });

    const recovered = runServerProbe(dir, `
      process.stdout.write(JSON.stringify({
        dbCount: backend.sqliteStorage.count(),
        eventIds: backend.sqliteStorage.loadAllRecords().map(row => row.eventId),
        pendingCommands: backend.getPendingCommands().map(command => command.status),
        journal: fs.existsSync(path.join(process.env.OBD_DATA_DIR, 'txn_journal.json'))
      }));
      await fastify.close();
    `);
    expect(recovered).toEqual({
      dbCount: 1,
      eventIds: ['mixed-crash-1'],
      pendingCommands: ['unknown'],
      journal: false
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('failed command-queue staging leaves SQLite untouched and permits a clean retry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-sqlite-staging-'));
  try {
    const result = runServerProbe(dir, `
      const command = await fastify.inject({
        method: 'POST', url: '/api/commands', headers: auth,
        payload: { command: 'read_dtc' }
      });
      if (command.statusCode !== 200) throw new Error(command.body);
      const originalWrite = fs.writeFileSync;
      let injected = false;
      fs.writeFileSync = (target, ...rest) => {
        if (!injected && String(target).includes('commands_queue.json.txn.')) {
          injected = true;
          throw new Error('simulated staging failure');
        }
        return originalWrite.call(fs, target, ...rest);
      };
      const payload = [{ timestamp: Date.now(), eventId: 'stage-retry-1', speed: 14 }];
      const failed = await fastify.inject({
        method: 'POST', url: '/api/telemetry/batch', headers: auth, payload
      });
      fs.writeFileSync = originalWrite;
      const countAfterFailure = backend.sqliteStorage.count();
      const queuedAfterFailure = backend.getPendingCommands().length;
      const retry = await fastify.inject({
        method: 'POST', url: '/api/telemetry/batch', headers: auth, payload
      });
      process.stdout.write(JSON.stringify({
        injected,
        failedStatus: failed.statusCode,
        countAfterFailure,
        queuedAfterFailure,
        retryStatus: retry.statusCode,
        retryCommands: retry.json().commands,
        countAfterRetry: backend.sqliteStorage.count(),
        journal: fs.existsSync(path.join(process.env.OBD_DATA_DIR, 'txn_journal.json'))
      }));
      await fastify.close();
    `);
    expect(result).toEqual({
      injected: true,
      failedStatus: 503,
      countAfterFailure: 0,
      queuedAfterFailure: 1,
      retryStatus: 201,
      retryCommands: ['read_dtc'],
      countAfterRetry: 1,
      journal: false
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('vehicle reassignment collision rejects before either store changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-sqlite-collision-'));
  try {
    const result = runServerProbe(dir, `
      const created = await fastify.inject({
        method: 'POST', url: '/api/vehicles', headers: auth,
        payload: { name: 'Collision Car' }
      });
      if (created.statusCode !== 201) throw new Error(created.body);
      const vehicleId = created.json().id;
      for (const target of ['default', vehicleId]) {
        const ingested = await fastify.inject({
          method: 'POST', url: '/api/telemetry/batch', headers: auth,
          payload: [{ timestamp: Date.now(), vehicleId: target, eventId: 'same-event-id', speed: 12 }]
        });
        if (ingested.statusCode !== 201) throw new Error(ingested.body);
      }
      const deletion = await fastify.inject({
        method: 'DELETE', url: '/api/vehicles/' + vehicleId + '?reassign=default', headers: auth
      });
      process.stdout.write(JSON.stringify({
        status: deletion.statusCode,
        vehicleId,
        vehicleInMemory: backend.vehiclesStore.some(v => v.id === vehicleId),
        vehicleOnDisk: JSON.parse(fs.readFileSync(path.join(process.env.OBD_DATA_DIR, 'vehicles.json'), 'utf8')).some(v => v.id === vehicleId),
        vehiclesInSqlite: backend.sqliteStorage.loadAllRecords().map(r => r.vehicleId).sort(),
        journal: fs.existsSync(path.join(process.env.OBD_DATA_DIR, 'txn_journal.json'))
      }));
      await fastify.close();
    `);
    expect(result.status).toBe(409);
    expect(result.vehicleInMemory).toBe(true);
    expect(result.vehicleOnDisk).toBe(true);
    expect(result.vehiclesInSqlite).toEqual(['default', result.vehicleId].sort());
    expect(result.journal).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('vehicle reassignment recovers SQLite and all files after a mid-commit crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-sqlite-vehicle-'));
  try {
    const first = runServerProbe(dir, `
      const created = await fastify.inject({
        method: 'POST', url: '/api/vehicles', headers: auth,
        payload: { name: 'Reassign Car' }
      });
      if (created.statusCode !== 201) throw new Error(created.body);
      const vehicleId = created.json().id;
      const telemetry = await fastify.inject({
        method: 'POST', url: '/api/telemetry/batch', headers: auth,
        payload: [{ timestamp: Date.now(), vehicleId, eventId: 'vehicle-crash-1', speed: 20 }]
      });
      if (telemetry.statusCode !== 201) throw new Error(telemetry.body);
      const fuel = await fastify.inject({
        method: 'POST', url: '/api/fuel-logs', headers: auth,
        payload: { vehicleId, eventId: 'vehicle-fuel-1', litres: 5, odometer: 120 }
      });
      if (fuel.statusCode !== 201) throw new Error(fuel.body);
      const originalRename = fs.renameSync;
      let injected = false;
      fs.renameSync = (from, to, ...rest) => {
        if (!injected && String(to).endsWith('vehicles.json') &&
            String(from).includes('.txn.')) {
          injected = true;
          throw new Error('simulated crash after SQLite vehicle reassignment');
        }
        return originalRename.call(fs, from, to, ...rest);
      };
      const deletion = await fastify.inject({
        method: 'DELETE', url: '/api/vehicles/' + vehicleId + '?reassign=default', headers: auth
      });
      fs.renameSync = originalRename;
      process.stdout.write(JSON.stringify({
        vehicleId,
        status: deletion.statusCode,
        injected,
        poisoned: backend.isPoisoned(),
        journal: fs.existsSync(path.join(process.env.OBD_DATA_DIR, 'txn_journal.json'))
      }));
      process.exit(0);
    `);
    expect(first.status).toBe(503);
    expect(first.injected).toBe(true);
    expect(first.poisoned).toBe(true);
    expect(first.journal).toBe(true);

    const recovered = runServerProbe(dir, `
      process.stdout.write(JSON.stringify({
        vehicleExists: backend.vehiclesStore.some(v => v.id === ${JSON.stringify(first.vehicleId)}),
        sqliteVehicles: backend.sqliteStorage.loadAllRecords().map(r => r.vehicleId),
        fuelVehicles: backend.fuelLogsStore.map(r => r.vehicleId),
        journal: fs.existsSync(path.join(process.env.OBD_DATA_DIR, 'txn_journal.json'))
      }));
      await fastify.close();
    `);
    expect(recovered).toEqual({
      vehicleExists: false,
      sqliteVehicles: ['default'],
      fuelVehicles: ['default'],
      journal: false
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
