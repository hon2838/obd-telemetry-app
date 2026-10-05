// Fuel logs and consumption statistics routes plugin
const crypto = require('crypto');

const FILL_STATES = new Set(['full', 'partial', 'unknown']);
const fillStateOf = log => FILL_STATES.has(log.fillState) ? log.fillState : 'unknown';

function calculateFuel(logs, defaultVehicleId = 'default') {
  const groups = new Map();
  for (const log of logs) {
    const vehicleId = log.vehicleId || defaultVehicleId;
    if (!groups.has(vehicleId)) groups.set(vehicleId, []);
    groups.get(vehicleId).push({ ...log, vehicleId, fillState: fillStateOf(log), economy: null,
      economyStatus: 'unknown-fill' });
  }
  const decorated = [];
  const cycles = [];
  let totalDistance = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => a.timestamp - b.timestamp || a.odometer - b.odometer);
    const bounds = group.reduce((range, log) => Number.isFinite(log.odometer) && log.odometer >= 0
      ? { min: Math.min(range.min, log.odometer), max: Math.max(range.max, log.odometer) } : range, { min: Infinity, max: -Infinity });
    if (Number.isFinite(bounds.min)) totalDistance += bounds.max - bounds.min;
    let anchor = null;
    let accumulatedLitres = 0;
    let previousOdometer = null;
    for (const log of group) {
      const valid = Number.isFinite(log.odometer) && log.odometer >= 0 && Number.isFinite(log.litres) && log.litres > 0;
      // A reset or invalid historical record cannot define a consumption cycle.
      if (!valid || (previousOdometer !== null && log.odometer <= previousOdometer)) {
        anchor = null;
        accumulatedLitres = 0;
        log.economyStatus = 'invalid-interval';
      } else if (log.fillState === 'unknown') {
        // Older records never silently become full-tank measurements.
        anchor = null;
        accumulatedLitres = 0;
      } else if (log.fillState === 'partial') {
        if (anchor) accumulatedLitres += log.litres;
        log.economyStatus = 'partial-fill';
      } else {
        if (anchor) {
          const distance = log.odometer - anchor.odometer;
          const litres = accumulatedLitres + log.litres;
          log.economy = Number((distance / litres).toFixed(2));
          log.cycleDistance = distance;
          log.cycleLitres = litres;
          log.economyStatus = 'full-cycle';
          cycles.push({ distance, litres, economy: distance / litres });
        } else {
          log.economyStatus = 'full-baseline';
        }
        anchor = log;
        accumulatedLitres = 0;
      }
      previousOdometer = valid ? log.odometer : null;
      decorated.push(log);
    }
  }
  const totalCycleLitres = cycles.reduce((sum, cycle) => sum + cycle.litres, 0);
  const totalCycleDistance = cycles.reduce((sum, cycle) => sum + cycle.distance, 0);
  const economyBounds = cycles.reduce((range, cycle) => ({ min: Math.min(range.min, cycle.economy), max: Math.max(range.max, cycle.economy) }), { min: Infinity, max: -Infinity });
  const round = (number, places = 2) => Number(number.toFixed(places));
  return {
    logs: decorated.sort((a, b) => b.timestamp - a.timestamp || b.odometer - a.odometer),
    stats: {
      averageKmPerLitre: round(totalCycleLitres > 0 ? totalCycleDistance / totalCycleLitres : 0),
      bestKmPerLitre: round(cycles.length ? economyBounds.max : 0),
      worstKmPerLitre: round(cycles.length ? economyBounds.min : 0),
      totalLitres: round(logs.reduce((sum, log) => sum + (Number.isFinite(log.litres) ? log.litres : 0), 0), 1),
      totalDistance: round(totalDistance, 1),
      logCount: logs.length,
      cycleCount: cycles.length,
      cycleDistance: round(totalCycleDistance, 1),
      cycleLitres: round(totalCycleLitres, 1),
      unknownFillCount: logs.filter(log => fillStateOf(log) === 'unknown').length
    }
  };
}

async function fuelRoutes(fastify, options) {
  const {
    serializeMutation,
    validateEventId,
    vehicleExists,
    DEFAULT_VEHICLE_ID,
    classifyEventIds,
    fuelLogsStore,
    FUEL_PATH,
    persist,
    replaceArrayContents,
    invalidateAnalyticsCaches,
    eventIdOf,
    retryablePersistenceError,
    resolveVehicleQuery,
    filterRecordsByScope
  } = options;

  // POST /api/fuel-logs - Add one or more fuel log entries
  fastify.post('/api/fuel-logs', async (request, reply) => {
    const auth = request.auth;
    const payload = request.body;
    if (!payload) return reply.status(400).send({ error: 'Missing request body' });
    const logsToAdd = Array.isArray(payload) ? payload : [payload];

    return serializeMutation(async () => {
      try {
        for (const item of logsToAdd) {
          if (!item || typeof item !== 'object' || !validateEventId(item)) {
            return reply.status(400).send({ error: 'Invalid fuel log' });
          }
          if (item.vehicleId !== undefined && !vehicleExists(item.vehicleId)) {
            return reply.status(400).send({ error: `Unknown vehicleId: ${item.vehicleId}` });
          }
          const litres = Number(item.litres);
          const odometer = Number(item.odometer);
          if (![item.litres, item.odometer].every(value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))) || !Number.isFinite(litres) || litres <= 0 || !Number.isFinite(odometer) || odometer < 0) {
            return reply.status(400).send({ error: 'litres must be positive and odometer must be non-negative finite numbers' });
          }
          if (item.fillState !== undefined && !FILL_STATES.has(item.fillState)) {
            return reply.status(400).send({ error: 'fillState must be full, partial, or unknown' });
          }
        }

        const normalized = logsToAdd.map((item, index) => ({
          id: item.id || `${Date.now()}-${index}-${crypto.randomBytes(4).toString('hex')}`,
          vehicleId: item.vehicleId || (auth?.type === 'device' ? auth.vehicleId : DEFAULT_VEHICLE_ID),
          ...(item.eventId !== undefined ? { eventId: item.eventId } : {}),
          timestamp: Number.isFinite(Number(item.timestamp)) ? Number(item.timestamp) : Date.now(),
          litres: Number(item.litres),
          fillState: item.fillState === undefined ? 'unknown' : item.fillState,
          odometer: Number(item.odometer),
          source: item.source || (auth?.type === 'device' ? 'app' : 'web')
        }));
        const classified = classifyEventIds(fuelLogsStore, normalized);
        const candidate = fuelLogsStore.concat(classified.accepted).sort((a, b) => b.timestamp - a.timestamp);
        await persist(FUEL_PATH, candidate);
        replaceArrayContents(fuelLogsStore, candidate);
        invalidateAnalyticsCaches({ telemetry: classified.accepted.length > 0 });

        return reply.status(201).send({
          success: true,
          message: `Added ${classified.accepted.length} fuel logs.`,
          acceptedIds: classified.accepted.flatMap(item => eventIdOf(item) ? [eventIdOf(item)] : []),
          duplicateIds: classified.duplicate
        });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  });

  // GET /api/fuel-logs - Fetch all fuel log entries
  fastify.get('/api/fuel-logs', async (request, reply) => {
    const vehicle = resolveVehicleQuery(request.query);
    if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });

    const { logs } = calculateFuel(filterRecordsByScope(fuelLogsStore, request.auth, vehicle), DEFAULT_VEHICLE_ID);
    return reply.send(logs);
  });

  // DELETE /api/fuel-logs/:id - Delete a fuel log entry
  fastify.delete('/api/fuel-logs/:id', async (request, reply) => {
    const { id } = request.params;
    const idNum = parseInt(id);
    return serializeMutation(async () => {
      try {
        const candidate = fuelLogsStore.filter(log => log.id !== id && log.id !== idNum);
        if (candidate.length === fuelLogsStore.length) {
          return reply.status(404).send({ error: 'Fuel log not found' });
        }
        await persist(FUEL_PATH, candidate);
        replaceArrayContents(fuelLogsStore, candidate);
        invalidateAnalyticsCaches({ telemetry: true });
        return reply.send({ success: true, message: 'Fuel log deleted successfully' });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  });

  // GET /api/fuel-stats - Get calculated fuel stats (average km/L, total litres, total distance)
  fastify.get('/api/fuel-stats', async (request, reply) => {
    const vehicle = resolveVehicleQuery(request.query);
    if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });

    const scopedLogs = filterRecordsByScope(fuelLogsStore, request.auth, vehicle);
    return reply.send(calculateFuel(scopedLogs, DEFAULT_VEHICLE_ID).stats);
  });
}

module.exports = fuelRoutes;

module.exports.calculateFuel = calculateFuel;
