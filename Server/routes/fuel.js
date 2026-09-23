// Fuel logs and consumption statistics routes plugin
const crypto = require('crypto');

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
          if (!Number.isFinite(litres) || !Number.isFinite(odometer)) {
            return reply.status(400).send({ error: 'litres and odometer must be numbers' });
          }
        }

        const normalized = logsToAdd.map((item, index) => ({
          id: item.id || `${Date.now()}-${index}-${crypto.randomBytes(4).toString('hex')}`,
          vehicleId: item.vehicleId || (auth?.type === 'device' ? auth.vehicleId : DEFAULT_VEHICLE_ID),
          ...(item.eventId !== undefined ? { eventId: item.eventId } : {}),
          timestamp: Number.isFinite(Number(item.timestamp)) ? Number(item.timestamp) : Date.now(),
          litres: Number(item.litres),
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

    const sortedLogs = [...filterRecordsByScope(fuelLogsStore, request.auth, vehicle)].sort((a, b) => b.odometer - a.odometer);
    return reply.send(sortedLogs);
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
    if (scopedLogs.length < 2) {
      return reply.send({
        averageKmPerLitre: 0,
        bestKmPerLitre: 0,
        worstKmPerLitre: 0,
        totalLitres: scopedLogs.reduce((acc, log) => acc + log.litres, 0),
        totalDistance: 0,
        logCount: scopedLogs.length
      });
    }

    const sorted = [...scopedLogs].sort((a, b) => a.odometer - b.odometer);

    let totalLitresIntervals = 0;
    let totalDistanceIntervals = 0;
    const economies = [];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const distance = curr.odometer - prev.odometer;
      const litres = curr.litres;

      if (distance > 0 && litres > 0) {
        const kmPerL = distance / litres;
        economies.push(kmPerL);
        totalDistanceIntervals += distance;
        totalLitresIntervals += litres;
      }
    }

    const minOdo = sorted[0].odometer;
    const maxOdo = sorted[sorted.length - 1].odometer;
    const totalDistance = maxOdo - minOdo;
    const totalLitres = scopedLogs.reduce((acc, log) => acc + log.litres, 0);

    const averageKmPerLitre = totalLitresIntervals > 0 ? (totalDistanceIntervals / totalLitresIntervals) : 0;
    const bestKmPerLitre = economies.length > 0 ? Math.max(...economies) : 0;
    const worstKmPerLitre = economies.length > 0 ? Math.min(...economies) : 0;

    return reply.send({
      averageKmPerLitre: parseFloat(averageKmPerLitre.toFixed(2)),
      bestKmPerLitre: parseFloat(bestKmPerLitre.toFixed(2)),
      worstKmPerLitre: parseFloat(worstKmPerLitre.toFixed(2)),
      totalLitres: parseFloat(totalLitres.toFixed(1)),
      totalDistance: parseFloat(totalDistance.toFixed(1)),
      logCount: scopedLogs.length
    });
  });
}

module.exports = fuelRoutes;
