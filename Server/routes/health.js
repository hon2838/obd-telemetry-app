// Health check routes plugin
const PACKAGE_VERSION = require('../package.json').version;

async function healthRoutes(fastify, options) {
  const { stores, getStartedAt } = options;

  const handleHealth = async (request, reply) => {
    const startedAt = getStartedAt ? getStartedAt() : null;
    return reply.send({
      status: 'ok',
      service: 'obd-telemetry-server',
      version: process.env.OBD_SERVICE_VERSION || PACKAGE_VERSION,
      build_commit: process.env.OBD_BUILD_COMMIT || 'unknown',
      build_time: process.env.OBD_BUILD_TIME || 'unknown',
      uptime_seconds: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
      telemetry_records: typeof stores.getTelemetryCount === 'function'
        ? stores.getTelemetryCount()
        : (stores.telemetryDataStore ? stores.telemetryDataStore.length : 0),
      fuel_logs: stores.fuelLogsStore ? stores.fuelLogsStore.length : 0,
      maintenance_items: stores.maintenanceStore ? stores.maintenanceStore.length : 0,
    });
  };

  fastify.get('/healthz', handleHealth);
  fastify.get('/api/healthz', handleHealth);
}

module.exports = healthRoutes;
