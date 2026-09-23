// Maintenance tracking and service status routes plugin
const crypto = require('crypto');

function createMaintenanceHelpers(options) {
  const { fuelLogsStore, maintenanceStore, filterRecordsByScope } = options;

  function getMaintenanceItems(vehicleId = null, auth = null) {
    const scopedLogs = filterRecordsByScope(fuelLogsStore, auth, vehicleId);
    const sortedLogs = [...scopedLogs].sort((a, b) => b.odometer - a.odometer);
    const currentOdometer = sortedLogs.length > 0 ? sortedLogs[0].odometer : 0;

    return filterRecordsByScope(maintenanceStore, auth, vehicleId).map(item => {
      const kmSinceService = item.lastServiceOdo !== null && item.lastServiceOdo !== undefined
        ? Math.max(0, currentOdometer - item.lastServiceOdo)
        : 0;

      const daysSinceService = item.lastServiceDate !== null && item.lastServiceDate !== undefined
        ? Math.max(0, (Date.now() - item.lastServiceDate) / (1000 * 60 * 60 * 24))
        : 0;

      let kmUntilDue = null;
      if (item.intervalKm) {
        kmUntilDue = item.intervalKm - kmSinceService;
      }

      let daysUntilDue = null;
      if (item.intervalDays) {
        daysUntilDue = item.intervalDays - daysSinceService;
      }

      let status = 'ok';
      if ((kmUntilDue !== null && kmUntilDue <= 0) || (daysUntilDue !== null && daysUntilDue <= 0)) {
        status = 'overdue';
      } else if ((kmUntilDue !== null && kmUntilDue <= item.intervalKm * 0.1) || (daysUntilDue !== null && daysUntilDue <= item.intervalDays * 0.1)) {
        status = 'due_soon';
      }

      return {
        ...item,
        currentOdometer: parseFloat(currentOdometer.toFixed(1)),
        kmSinceService: parseFloat(kmSinceService.toFixed(1)),
        daysSinceService: Math.round(daysSinceService),
        kmUntilDue: kmUntilDue !== null ? parseFloat(kmUntilDue.toFixed(1)) : null,
        daysUntilDue: daysUntilDue !== null ? Math.round(daysUntilDue) : null,
        status
      };
    });
  }

  function getMaintenanceStatus(items = getMaintenanceItems()) {
    let okCount = 0;
    let dueSoonCount = 0;
    let overdueCount = 0;
    let nextUpcoming = null;
    let minKmRemaining = Infinity;

    items.forEach(item => {
      if (item.status === 'overdue') overdueCount++;
      else if (item.status === 'due_soon') dueSoonCount++;
      else okCount++;

      if (item.kmUntilDue !== null && item.kmUntilDue > 0 && item.kmUntilDue < minKmRemaining) {
        minKmRemaining = item.kmUntilDue;
        nextUpcoming = {
          name: item.name,
          kmRemaining: item.kmUntilDue,
          daysRemaining: item.daysUntilDue
        };
      }
    });

    return { okCount, dueSoonCount, overdueCount, nextUpcoming };
  }

  return { getMaintenanceItems, getMaintenanceStatus };
}

async function maintenanceRoutes(fastify, options) {
  const {
    serializeMutation,
    validateEventId,
    vehicleExists,
    DEFAULT_VEHICLE_ID,
    classifyEventIds,
    maintenanceStore,
    fuelLogsStore,
    MAINT_PATH,
    persist,
    replaceArrayContents,
    invalidateAnalyticsCaches,
    eventIdOf,
    retryablePersistenceError,
    resolveVehicleQuery,
    filterRecordsByScope,
    filterByVehicle
  } = options;

  const { getMaintenanceItems, getMaintenanceStatus } = createMaintenanceHelpers({
    fuelLogsStore,
    maintenanceStore,
    filterRecordsByScope
  });

  // GET all maintenance items with status
  fastify.get('/api/maintenance', async (request, reply) => {
    const vehicle = resolveVehicleQuery(request.query);
    if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });
    const items = getMaintenanceItems(vehicle, request.auth);
    return reply.send(items);
  });

  // POST a new maintenance item
  fastify.post('/api/maintenance', async (request, reply) => {
    const auth = request.auth;
    const payload = request.body || {};
    const itemsToAdd = Array.isArray(payload) ? payload : [payload];

    return serializeMutation(async () => {
      try {
        for (const item of itemsToAdd) {
          if (!item || typeof item !== 'object' || !item.name || !validateEventId(item)) {
            return reply.status(400).send({ error: 'Each maintenance item requires a name' });
          }
          if (item.vehicleId !== undefined && !vehicleExists(item.vehicleId)) {
            return reply.status(400).send({ error: `Unknown vehicleId: ${item.vehicleId}` });
          }
          if (item.intervalKm !== undefined && item.intervalKm !== null && !Number.isFinite(Number(item.intervalKm))) {
            return reply.status(400).send({ error: 'intervalKm must be a number' });
          }
          if (item.intervalDays !== undefined && item.intervalDays !== null && !Number.isFinite(Number(item.intervalDays))) {
            return reply.status(400).send({ error: 'intervalDays must be a number' });
          }
        }

        const normalized = itemsToAdd.map((item, index) => {
          const vid = item.vehicleId || (auth?.type === 'device' ? auth.vehicleId : DEFAULT_VEHICLE_ID);
          const vehicleLogs = filterByVehicle(fuelLogsStore, vid);
          const currentOdometer = vehicleLogs.length ? Math.max(...vehicleLogs.map(log => Number(log.odometer) || 0)) : 0;
          return {
            id: item.id || `${Date.now()}-${index}-${crypto.randomBytes(4).toString('hex')}`,
            vehicleId: vid,
            ...(item.eventId !== undefined ? { eventId: item.eventId } : {}),
            name: item.name,
            intervalKm: item.intervalKm ? Number(item.intervalKm) : null,
            intervalDays: item.intervalDays ? Number(item.intervalDays) : null,
            lastServiceOdo: item.lastServiceOdo !== undefined && item.lastServiceOdo !== null ? Number(item.lastServiceOdo) : currentOdometer,
            lastServiceDate: item.lastServiceDate !== undefined && item.lastServiceDate !== null ? Number(item.lastServiceDate) : Date.now(),
            notes: item.notes || '',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
        });
        const classified = classifyEventIds(maintenanceStore, normalized);
        const candidate = maintenanceStore.concat(classified.accepted);
        await persist(MAINT_PATH, candidate);
        replaceArrayContents(maintenanceStore, candidate);
        invalidateAnalyticsCaches({ telemetry: classified.accepted.length > 0 });

        return reply.status(201).send({
          success: true,
          message: `Added ${classified.accepted.length} maintenance items.`,
          acceptedIds: classified.accepted.flatMap(item => eventIdOf(item) ? [eventIdOf(item)] : []),
          duplicateIds: classified.duplicate
        });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  });

  // PUT to edit/update a maintenance item
  fastify.put('/api/maintenance/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};
    return serializeMutation(async () => {
      try {
        const index = maintenanceStore.findIndex(item => String(item.id) === String(id));
        if (index === -1) return reply.status(404).send({ error: 'Maintenance item not found' });

        const candidate = maintenanceStore.map(item => ({ ...item }));
        const item = candidate[index];
        if (body.markServiced) {
          const vehicleLogs = filterByVehicle(fuelLogsStore, item.vehicleId || DEFAULT_VEHICLE_ID);
          const currentOdometer = vehicleLogs.length
            ? Math.max(...vehicleLogs.map(log => Number(log.odometer) || 0))
            : 0;
          item.lastServiceOdo = currentOdometer;
          item.lastServiceDate = Date.now();
        } else {
          if (body.name !== undefined) item.name = body.name;
          if (body.intervalKm !== undefined) item.intervalKm = body.intervalKm ? Number(body.intervalKm) : null;
          if (body.intervalDays !== undefined) item.intervalDays = body.intervalDays ? Number(body.intervalDays) : null;
          if (body.lastServiceOdo !== undefined) item.lastServiceOdo = body.lastServiceOdo !== null ? Number(body.lastServiceOdo) : null;
          if (body.lastServiceDate !== undefined) item.lastServiceDate = body.lastServiceDate !== null ? Number(body.lastServiceDate) : null;
          if (body.notes !== undefined) item.notes = body.notes || '';
        }
        item.updatedAt = Date.now();
        await persist(MAINT_PATH, candidate);
        replaceArrayContents(maintenanceStore, candidate);
        invalidateAnalyticsCaches({ telemetry: true });
        return reply.send({ success: true, message: 'Maintenance item updated successfully' });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  });

  // DELETE a maintenance item
  fastify.delete('/api/maintenance/:id', async (request, reply) => {
    const { id } = request.params;
    return serializeMutation(async () => {
      try {
        const candidate = maintenanceStore.filter(item => String(item.id) !== String(id));
        if (candidate.length === maintenanceStore.length) {
          return reply.status(404).send({ error: 'Maintenance item not found' });
        }
        await persist(MAINT_PATH, candidate);
        replaceArrayContents(maintenanceStore, candidate);
        invalidateAnalyticsCaches({ telemetry: true });
        return reply.send({ success: true, message: 'Maintenance item deleted successfully' });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  });

  // GET maintenance summary status
  fastify.get('/api/maintenance/status', async (request, reply) => {
    const vehicle = resolveVehicleQuery(request.query);
    if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });
    return reply.send(getMaintenanceStatus(getMaintenanceItems(vehicle, request.auth)));
  });
}

module.exports = maintenanceRoutes;
module.exports.createMaintenanceHelpers = createMaintenanceHelpers;
