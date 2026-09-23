// Commands route plugin
const MAX_PENDING_COMMANDS = 10;
const MAX_COMMAND_TOMBSTONES = 100;
const MAX_RESULT_BYTES = 4096;
const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;
const COMMAND_PROTOCOL_HEADER = 'x-obd-command-protocol';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'unknown']);

function isCommandProtocolV2(request) {
  return request.headers[COMMAND_PROTOCOL_HEADER] === '2';
}

function commandStatusEntry(command) {
  const { id, command: name, vehicleId, status, createdAt, updatedAt, expiresAt, result } = command;
  return { id, command: name, vehicleId, status, createdAt, updatedAt, expiresAt, ...(result !== undefined ? { result } : {}) };
}

function trimTombstones(commands) {
  const pending = commands.filter(command => command.status === 'pending');
  const completed = commands
    .filter(command => command.status !== 'pending')
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, MAX_COMMAND_TOMBSTONES);
  return [...pending, ...completed];
}

function expireCommands(commands, now = Date.now()) {
  let changed = false;
  const expired = commands.map(command => {
    const createdAt = Number(command.createdAt) || now;
    const expiresAt = Number(command.expiresAt) || (createdAt + COMMAND_TTL_MS);
    if (command.status === 'pending' && now >= expiresAt) {
      changed = true;
      return { ...command, status: 'expired', updatedAt: now, result: { reason: 'command_expired' } };
    }
    return command;
  });
  return { commands: changed ? trimTombstones(expired) : commands, changed };
}

async function commandsRoutes(fastify, options) {
  const {
    DEFAULT_VEHICLE_ID,
    COMMANDS_QUEUE_PATH,
    vehicleExists,
    getPendingCommands,
    setPendingCommands,
    serializeMutation,
    persist,
    retryablePersistenceError,
    canAccessVehicle,
    vehicleScope,
    vehiclesStore,
    getDiagnosticsStore,
    setDiagnosticsStore,
    dtcHistoryStore,
    DIAG_PATH,
    DTC_HIST_PATH,
    runFileTransactionSync,
    parseDtcCodes
  } = options;

  fastify.post('/api/commands', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '15 minutes',
      },
    },
  }, async (request, reply) => {
    const { command, vehicleId } = request.body || {};
    if (!command || (command !== 'read_dtc' && command !== 'clear_dtc')) {
      return reply.status(400).send({ error: 'Invalid command. Must be read_dtc or clear_dtc' });
    }
    const targetVehicleId = vehicleId || DEFAULT_VEHICLE_ID;

    return serializeMutation(async () => {
      if (vehicleId !== undefined && !vehicleExists(vehicleId)) {
        return reply.status(400).send({ error: `Unknown vehicleId: ${vehicleId}` });
      }
      const pendingCommands = getPendingCommands();
      const now = Date.now();
      const expiry = expireCommands(pendingCommands, now);
      const queueAfterExpiry = expiry.commands;
      const pendingCount = queueAfterExpiry.filter(entry => entry.status === 'pending').length;
      if (pendingCount >= MAX_PENDING_COMMANDS) {
        return reply.status(429).send({
          error: 'Command queue is full. The paired vehicle must receive and acknowledge commands before more can be queued.',
          queue_size: pendingCount,
        });
      }
      const candidateQueue = queueAfterExpiry.concat({
        id: require('crypto').randomUUID(), command, vehicleId: targetVehicleId,
        status: 'pending', createdAt: now, updatedAt: now, expiresAt: now + COMMAND_TTL_MS
      });
      try {
        await persist(COMMANDS_QUEUE_PATH, trimTombstones(candidateQueue));
        setPendingCommands(trimTombstones(candidateQueue));
        return reply.send({ success: true, message: `Command ${command} queued.`, queue_size: pendingCount + 1 });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  });

  // V2 delivery is at-least-once: a command remains pending until its paired
  // device records a durable result and acknowledges it. Retrying this GET
  // after a lost response returns the same command IDs.
  fastify.get('/api/commands/pending', async (request, reply) => {
    if (!isCommandProtocolV2(request)) return reply.code(426).send({ error: 'Command protocol v2 is required' });
    if (request.auth?.type !== 'device') return reply.code(403).send({ error: 'Only paired devices can poll commands' });
    const vehicleId = request.auth.vehicleId;
    if (request.query?.vehicle && request.query.vehicle !== vehicleId) {
      return reply.code(403).send({ error: 'Vehicle access denied' });
    }
    return serializeMutation(async () => {
      const current = getPendingCommands();
      const expiry = expireCommands(current);
      if (expiry.changed) {
        try {
          await persist(COMMANDS_QUEUE_PATH, expiry.commands);
          setPendingCommands(expiry.commands);
        } catch (err) {
          return retryablePersistenceError(reply, request, err);
        }
      }
      const commands = (expiry.changed ? expiry.commands : current)
        .filter(entry => entry.status === 'pending' && entry.vehicleId === vehicleId)
        .map(({ id, command, vehicleId: target, expiresAt }) => ({ id, command, vehicleId: target, expiresAt }));
      return reply.send({ commands });
    });
  });

  // Persist the ACK and result before replying. Repeated ACKs with the same
  // terminal status are safe when the HTTP response itself is lost.
  fastify.post('/api/commands/ack', async (request, reply) => {
    if (!isCommandProtocolV2(request)) return reply.code(426).send({ error: 'Command protocol v2 is required' });
    if (request.auth?.type !== 'device') return reply.code(403).send({ error: 'Only paired devices can acknowledge commands' });
    const { id, status, result } = request.body || {};
    if (typeof id !== 'string' || id.length < 16 || id.length > 80 || !TERMINAL_STATUSES.has(status)) {
      return reply.code(400).send({ error: 'A valid command id and terminal status are required' });
    }
    if (result !== undefined) {
      if (result === null || typeof result !== 'object' || Array.isArray(result)) {
        return reply.code(400).send({ error: 'result must be a JSON object' });
      }
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESULT_BYTES) {
        return reply.code(413).send({ error: 'result exceeds the 4096 byte limit' });
      }
    }

    return serializeMutation(async () => {
      const queue = getPendingCommands();
      const index = queue.findIndex(entry => entry.id === id);
      if (index < 0) return reply.code(404).send({ error: 'Command not found or acknowledgment expired' });
      const current = queue[index];
      if (current.vehicleId !== request.auth.vehicleId) {
        return reply.code(403).send({ error: 'Command belongs to another vehicle' });
      }
      const lateAfterExpiry = current.status === 'expired';
      if (current.status !== 'pending' && !lateAfterExpiry) {
        if (current.status === status) return reply.send({ success: true, alreadyAcknowledged: true, status: current.status });
        return reply.code(409).send({ error: 'Command was already acknowledged with a different status', status: current.status });
      }
      if (status === 'completed') {
        if (current.command === 'read_dtc' && typeof result?.dtc !== 'string') {
          return reply.code(400).send({ error: 'A completed read_dtc acknowledgment must include result.dtc as a string' });
        }
        if (current.command === 'clear_dtc' && result?.success !== true) {
          return reply.code(400).send({ error: 'A completed clear_dtc acknowledgment must include result.success=true' });
        }
      }
      const now = Date.now();
      const expiry = expireCommands(queue);
      const candidate = expiry.commands.slice();
      const liveIndex = candidate.findIndex(entry => entry.id === id);
      if (liveIndex < 0) {
        if (expiry.changed) {
          try {
            await persist(COMMANDS_QUEUE_PATH, expiry.commands);
            setPendingCommands(expiry.commands);
          } catch (err) {
            return retryablePersistenceError(reply, request, err);
          }
        }
        return reply.code(410).send({ error: 'Command expired before acknowledgment' });
      }
      const candidateExpired = candidate[liveIndex].status === 'expired';
      candidate[liveIndex] = {
        ...candidate[liveIndex],
        status,
        updatedAt: now,
        ...(result !== undefined ? { result: candidateExpired ? { ...result, lateAckAfterExpiry: true } : result } : {})
      };
      const bounded = trimTombstones(candidate);
      try {
        if (status === 'completed' && getDiagnosticsStore && setDiagnosticsStore && Array.isArray(dtcHistoryStore)) {
          const diagnostics = getDiagnosticsStore();
          const nextDiagnostics = JSON.parse(JSON.stringify(diagnostics));
          const vehicleId = current.vehicleId;
          if (!nextDiagnostics.byVehicle[vehicleId]) {
            nextDiagnostics.byVehicle[vehicleId] = {
              latestDtc: { code: '', timestamp: null },
              latestClearStatus: { success: null, timestamp: null }
            };
          }
          const historyEntry = {
            id: `command-${current.id}`,
            vehicleId,
            timestamp: now,
            type: current.command === 'read_dtc' ? 'read' : 'clear',
            codes: current.command === 'read_dtc' ? parseDtcCodes(result.dtc) : [],
            success: true
          };
          const nextHistory = dtcHistoryStore.concat(historyEntry);
          if (current.command === 'read_dtc') {
            nextDiagnostics.byVehicle[vehicleId].latestDtc = { code: result.dtc || 'No trouble codes found', timestamp: now };
          } else {
            nextDiagnostics.byVehicle[vehicleId].latestClearStatus = { success: true, timestamp: now };
          }
          runFileTransactionSync([
            [COMMANDS_QUEUE_PATH, bounded],
            [DIAG_PATH, nextDiagnostics],
            [DTC_HIST_PATH, nextHistory]
          ]);
          setDiagnosticsStore(nextDiagnostics);
          dtcHistoryStore.push(historyEntry);
        } else {
          await persist(COMMANDS_QUEUE_PATH, bounded);
        }
        setPendingCommands(bounded);
        return reply.send({ success: true, alreadyAcknowledged: false, status });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  });

  // User/admin status view. Keep the response bounded and scoped to the
  // requested vehicle so dashboard polling cannot expose another garage.
  fastify.get('/api/commands/status', async (request, reply) => {
    const auth = request.auth;
    const requestedVehicle = request.query?.vehicle;
    let vehicleIds;
    if (requestedVehicle) {
      if (!canAccessVehicle(auth, requestedVehicle)) return reply.code(403).send({ error: 'Vehicle access denied' });
      vehicleIds = [requestedVehicle];
    } else {
      const scope = vehicleScope(auth);
      vehicleIds = scope === null
        ? [DEFAULT_VEHICLE_ID, ...(vehiclesStore || []).map(vehicle => vehicle.id)]
        : scope;
    }
    return serializeMutation(async () => {
      const current = getPendingCommands();
      const expiry = expireCommands(current);
      if (expiry.changed) {
        try {
          await persist(COMMANDS_QUEUE_PATH, expiry.commands);
          setPendingCommands(expiry.commands);
        } catch (err) {
          return retryablePersistenceError(reply, request, err);
        }
      }
      const commands = (expiry.changed ? expiry.commands : current)
        .filter(entry => vehicleIds.includes(entry.vehicleId))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, MAX_PENDING_COMMANDS + MAX_COMMAND_TOMBSTONES)
        .map(commandStatusEntry);
      return reply.send({ commands });
    });
  });
}

module.exports = commandsRoutes;
module.exports.MAX_PENDING_COMMANDS = MAX_PENDING_COMMANDS;
module.exports.MAX_COMMAND_TOMBSTONES = MAX_COMMAND_TOMBSTONES;
module.exports.trimTombstones = trimTombstones;
module.exports.expireCommands = expireCommands;
