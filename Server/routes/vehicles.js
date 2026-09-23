// Vehicle registry CRUD routes plugin
const crypto = require('crypto');

async function vehiclesRoutes(fastify, options) {
  const {
    vehicleScope,
    vehiclesStore,
    telemetryDataStore,
    fuelLogsStore,
    maintenanceStore,
    dtcHistoryStore,
    getDiagnosticsStore,
    setDiagnosticsStore,
    getPendingCommands,
    setPendingCommands,
    devicesStore,
    usersStore,
    DEFAULT_VEHICLE_ID,
    VEHICLE_ID_PATTERN,
    isValidVehicleName,
    vehicleExists,
    serializeMutation,
    runFileTransactionSync,
    persist,
    replaceArrayContents,
    invalidateAnalyticsCaches,
    syncTelemetryEventKeySet,
    retryablePersistenceError,
    sqliteStorage,
    VEHICLES_PATH,
    USERS_PATH,
    DB_PATH,
    FUEL_PATH,
    MAINT_PATH,
    DTC_HIST_PATH,
    DIAG_PATH,
    COMMANDS_QUEUE_PATH,
    DEVICES_PATH
  } = options;

  // ----- Vehicle registry CRUD ----------------------------------------------
  //
  // Vehicles are a small, rarely-changed config list, so writes are
  // guarded by the same shared API key as other mutating endpoints
  // (absent header is tolerated for dashboard parity, but a wrong key
  // is always rejected). Deleting a vehicle that still owns data is
  // refused with 409 unless ?reassign=default explicitly re-homes the
  // records — this prevents accidental history loss.

  fastify.get('/api/vehicles', async (request, reply) => {
    const scope = vehicleScope(request.auth);
    const scopedVehicles = scope === null ? vehiclesStore : vehiclesStore.filter(v => scope.includes(v.id));
    return reply.send(scopedVehicles.map(v => ({
      ...v,
      recordCount: {
        telemetry: telemetryDataStore.filter(r => (r.vehicleId || DEFAULT_VEHICLE_ID) === v.id).length,
        fuelLogs: fuelLogsStore.filter(r => (r.vehicleId || DEFAULT_VEHICLE_ID) === v.id).length,
        maintenance: maintenanceStore.filter(r => (r.vehicleId || DEFAULT_VEHICLE_ID) === v.id).length,
      }
    })));
  });

  fastify.post('/api/vehicles', async (request, reply) => {
    const auth = request.auth;
    const { name, vehicleId, tankLitres } = request.body || {};
    if (!isValidVehicleName(name)) {
      return reply.status(400).send({ error: 'Body must include a name (1-64 chars)' });
    }

    let id = vehicleId;
    if (id !== undefined) {
      if (typeof id !== 'string' || !VEHICLE_ID_PATTERN.test(id)) {
        return reply.status(400).send({ error: 'vehicleId must match [A-Za-z0-9_-]{1,64}' });
      }
      if (id === DEFAULT_VEHICLE_ID) {
        return reply.status(400).send({ error: `'${DEFAULT_VEHICLE_ID}' is reserved` });
      }
      if (vehicleExists(id)) {
        return reply.status(409).send({ error: `Vehicle already exists: ${id}` });
      }
    } else {
      do {
        id = `veh-${crypto.randomBytes(4).toString('hex')}`;
      } while (vehicleExists(id));
    }

    const vehicle = { id, name: name.trim(), createdAt: Date.now() };
    if (tankLitres !== undefined) {
      const tank = Number(tankLitres);
      if (!Number.isFinite(tank) || tank <= 0 || tank > 500) {
        return reply.status(400).send({ error: 'tankLitres must be a positive number (<= 500)' });
      }
      vehicle.tankLitres = tank;
    }

    const candidateVehicle = { ...vehicle };
    if (auth && auth.type === 'user' && auth.user) {
      return serializeMutation(async () => {
        try {
          const candidateUsers = usersStore.map(user => {
            if (user.id !== auth.user.id) return user;
            const assigned = Array.isArray(user.vehicles) ? [...user.vehicles] : [];
            if (!assigned.includes(id)) assigned.push(id);
            return { ...user, vehicles: assigned };
          });
          // Registry and assignment commit as one transaction so a failed
          // user write cannot leave a vehicle on disk that no one owns.
          const txnEntries = [[VEHICLES_PATH, [...vehiclesStore, candidateVehicle]]];
          if (!auth.user.vehicles?.includes(id)) txnEntries.push([USERS_PATH, candidateUsers]);
          runFileTransactionSync(txnEntries);
          vehiclesStore.push(candidateVehicle);
          if (!Array.isArray(auth.user.vehicles)) auth.user.vehicles = [];
          if (!auth.user.vehicles.includes(id)) auth.user.vehicles.push(id);
        } catch (err) {
          return retryablePersistenceError(reply, request, err);
        }
        invalidateAnalyticsCaches({ vehicles: true });
        return reply.status(201).send(candidateVehicle);
      });
    }
    return serializeMutation(async () => {
      try {
        runFileTransactionSync([[VEHICLES_PATH, [...vehiclesStore, candidateVehicle]]]);
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
      vehiclesStore.push(candidateVehicle);
      invalidateAnalyticsCaches({ vehicles: true });
      return reply.status(201).send(candidateVehicle);
    });
  });

  fastify.put('/api/vehicles/:id', async (request, reply) => {
    const vehicle = vehiclesStore.find(v => v.id === request.params.id);
    if (!vehicle) {
      return reply.status(404).send({ error: 'Vehicle not found' });
    }

    const { name, tankLitres } = request.body || {};
    const updatedVehicle = { ...vehicle };
    if (name !== undefined) {
      if (!isValidVehicleName(name)) {
        return reply.status(400).send({ error: 'name must be 1-64 chars' });
      }
      updatedVehicle.name = name.trim();
    }
    if (tankLitres !== undefined) {
      const tank = Number(tankLitres);
      if (!Number.isFinite(tank) || tank <= 0 || tank > 500) {
        return reply.status(400).send({ error: 'tankLitres must be a positive number (<= 500)' });
      }
      updatedVehicle.tankLitres = tank;
    }

    const candidateVehicles = vehiclesStore.map(item => item.id === vehicle.id ? updatedVehicle : item);
    return serializeMutation(async () => {
      try {
        await persist(VEHICLES_PATH, candidateVehicles);
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
      Object.assign(vehicle, updatedVehicle);
      invalidateAnalyticsCaches({ vehicles: true });
      return reply.send(vehicle);
    });
  });

  fastify.delete('/api/vehicles/:id', async (request, reply) => {
    const id = request.params.id;
    if (id === DEFAULT_VEHICLE_ID) {
      return reply.status(400).send({ error: 'The default vehicle cannot be deleted' });
    }
    if (!vehicleExists(id)) {
      return reply.status(404).send({ error: 'Vehicle not found' });
    }

    return serializeMutation(async () => {
      try {
        const reassign = request.query.reassign === DEFAULT_VEHICLE_ID;
        const ownsData = records => records.some(r => (r.vehicleId || DEFAULT_VEHICLE_ID) === id);
        if (!reassign && (ownsData(telemetryDataStore) || ownsData(fuelLogsStore) || ownsData(maintenanceStore) || ownsData(dtcHistoryStore))) {
          return reply.status(409).send({
            error: 'Vehicle still owns records. Pass ?reassign=default to move them to the default vehicle.'
          });
        }

        const move = record => reassign && (record.vehicleId || DEFAULT_VEHICLE_ID) === id
          ? { ...record, vehicleId: DEFAULT_VEHICLE_ID }
          : { ...record };
        const telemetryCandidate = reassign ? telemetryDataStore.map(move) : telemetryDataStore.slice();
        const fuelCandidate = reassign ? fuelLogsStore.map(move) : fuelLogsStore.slice();
        const maintenanceCandidate = reassign ? maintenanceStore.map(move) : maintenanceStore.slice();
        const dtcHistoryCandidate = reassign ? dtcHistoryStore.map(move) : dtcHistoryStore.slice();
        const diagnosticsCandidate = JSON.parse(JSON.stringify(getDiagnosticsStore()));
        const diagnosticChanged = Boolean(diagnosticsCandidate.byVehicle && diagnosticsCandidate.byVehicle[id]);
        if (diagnosticChanged) {
          const slot = diagnosticsCandidate.byVehicle[id];
          if (reassign) {
            const existing = diagnosticsCandidate.byVehicle[DEFAULT_VEHICLE_ID];
            if (existing) {
              if (!existing.latestDtc?.timestamp && slot.latestDtc?.timestamp) existing.latestDtc = slot.latestDtc;
              if (!existing.latestClearStatus?.timestamp && slot.latestClearStatus?.timestamp) existing.latestClearStatus = slot.latestClearStatus;
            } else {
              diagnosticsCandidate.byVehicle[DEFAULT_VEHICLE_ID] = slot;
            }
          }
          delete diagnosticsCandidate.byVehicle[id];
        }
        const currentCommands = getPendingCommands();
        const commandsChanged = currentCommands.some(c => c.vehicleId === id);
        const commandsCandidate = reassign
          ? currentCommands.map(c => c.vehicleId === id ? { ...c, vehicleId: DEFAULT_VEHICLE_ID } : { ...c })
          : currentCommands.filter(c => c.vehicleId !== id);
        const vehiclesCandidate = vehiclesStore.filter(v => v.id !== id);
        const devicesCandidate = devicesStore.filter(d => d.vehicleId !== id);
        const usersCandidate = usersStore.map(user => ({
          ...user,
          ...(Array.isArray(user.vehicles) ? { vehicles: user.vehicles.filter(v => v !== id) } : {})
        }));

        // SQLite enforces event IDs per vehicle. Reassigning into an existing
        // event ID would fail after the file transaction entered COMMITTING,
        // leaving an operation that startup could never replay successfully.
        if (reassign && sqliteStorage && sqliteStorage.hasReassignConflict(id, DEFAULT_VEHICLE_ID)) {
          return reply.status(409).send({
            error: 'The destination vehicle already contains a telemetry event ID from this vehicle.'
          });
        }

        // The durable journal covers SQLite and every affected JSON file.
        const txnEntries = [];
        if (reassign) {
          if (!sqliteStorage) txnEntries.push([DB_PATH, telemetryCandidate]);
          txnEntries.push([FUEL_PATH, fuelCandidate]);
          txnEntries.push([MAINT_PATH, maintenanceCandidate]);
          txnEntries.push([DTC_HIST_PATH, dtcHistoryCandidate]);
        }
        if (diagnosticChanged) txnEntries.push([DIAG_PATH, diagnosticsCandidate]);
        if (commandsChanged) txnEntries.push([COMMANDS_QUEUE_PATH, commandsCandidate]);
        txnEntries.push([VEHICLES_PATH, vehiclesCandidate]);
        if (devicesCandidate.length !== devicesStore.length) txnEntries.push([DEVICES_PATH, devicesCandidate]);
        const usersChanged = usersCandidate.some((user, index) => JSON.stringify(user) !== JSON.stringify(usersStore[index]));
        if (usersChanged) txnEntries.push([USERS_PATH, usersCandidate]);
        runFileTransactionSync(txnEntries, reassign && sqliteStorage ? {
          type: 'reassignVehicle',
          oldVehicleId: id,
          newVehicleId: DEFAULT_VEHICLE_ID
        } : null);

        replaceArrayContents(vehiclesStore, vehiclesCandidate);
        if (reassign) {
          replaceArrayContents(telemetryDataStore, telemetryCandidate);
          syncTelemetryEventKeySet();
          replaceArrayContents(fuelLogsStore, fuelCandidate);
          replaceArrayContents(maintenanceStore, maintenanceCandidate);
          replaceArrayContents(dtcHistoryStore, dtcHistoryCandidate);
        }
        if (diagnosticChanged) setDiagnosticsStore(diagnosticsCandidate);
        if (commandsChanged) setPendingCommands(commandsCandidate);
        if (devicesCandidate.length !== devicesStore.length) replaceArrayContents(devicesStore, devicesCandidate);
        if (usersCandidate.some((user, index) => JSON.stringify(user) !== JSON.stringify(usersStore[index]))) replaceArrayContents(usersStore, usersCandidate);
        invalidateAnalyticsCaches({ telemetry: reassign, vehicles: true });
        return reply.send({ success: true, message: reassign ? 'Vehicle deleted; records reassigned to default.' : 'Vehicle deleted.' });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  });
}

module.exports = vehiclesRoutes;
