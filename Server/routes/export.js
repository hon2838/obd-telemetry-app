// Drive CSV and GPX export routes plugin
const { Readable } = require('stream');

function* driveCsvChunks(records) {
  yield 'Timestamp,Time,RPM,Speed,CoolantTemp,Latitude,Longitude,Altitude,GPSSpeed,EngineLoad,ThrottlePos,FuelLevel,AmbientTemp,Voltage,AccelTime,AlertCoolant,AlertVoltage,MAF (g/s),FuelSystemStatus (code),EstimatedFuelRate (L/h),EstimatedFuelEconomy (km/L),IAT (°C),MAP (kPa)\n';
  for (const record of records) {
    const timeStr = new Date(record.timestamp).toISOString();
    yield `${record.timestamp},${timeStr},${record.rpm ?? ''},${record.speed ?? ''},${record.coolantTemp ?? ''},${record.latitude ?? ''},${record.longitude ?? ''},${record.altitude ?? ''},${record.gpsSpeed ?? ''},${record.engineLoad ?? ''},${record.throttlePos ?? ''},${record.fuelLevel ?? ''},${record.ambientTemp ?? ''},${record.voltage ?? ''},${record.accelTime ?? ''},${record.alertCoolant ? 'true' : 'false'},${record.alertVoltage ? 'true' : 'false'},${record.mafGps ?? ''},${record.fuelSystemStatus ?? ''},${record.estimatedFuelRateLph ?? ''},${record.estimatedFuelEconomyKmL ?? ''},${record.iat ?? ''},${record.map ?? ''}\n`;
  }
}

function* driveGpxChunks(id, bounds, records, getRecordSpeed) {
  yield `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Axia Telemetry Core" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Drive #${id} Telemetry</name>
    <time>${new Date(bounds.startTime).toISOString()}</time>
  </metadata>
  <trk>
    <name>Drive #${id}</name>
    <trkseg>
`;
  for (const record of records) {
    const latitude = Number(record.latitude);
    const longitude = Number(record.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude) &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 &&
        (latitude !== 0 || longitude !== 0)) {
      const timeStr = new Date(record.timestamp).toISOString();
      const elevation = record.altitude === null || record.altitude === undefined || record.altitude === ''
        ? null
        : Number(record.altitude);
      yield `      <trkpt lat="${latitude}" lon="${longitude}">
${elevation !== null && Number.isFinite(elevation) ? `        <ele>${elevation}</ele>\n` : ''}        <time>${timeStr}</time>
        <extensions>
          <rpm>${record.rpm ?? 0}</rpm>
          <speed>${getRecordSpeed(record)}</speed>
          <temp>${record.coolantTemp ?? 0}</temp>
        </extensions>
      </trkpt>\n`;
    }
  }
  yield `    </trkseg>
  </trk>
</gpx>`;
}

async function exportRoutes(fastify, options) {
  const {
    getDriveBounds,
    telemetryDataStore,
    DEFAULT_VEHICLE_ID,
    getRecordSpeed,
    sqliteStorage
  } = options;

  function driveRecords(bounds) {
    if (sqliteStorage) {
      return sqliteStorage.getRecordsForDrive(bounds.vehicleId || DEFAULT_VEHICLE_ID, bounds.startTime, bounds.endTime);
    }
    return telemetryDataStore.filter(record =>
      record.timestamp >= bounds.startTime && record.timestamp <= bounds.endTime &&
      (record.vehicleId || DEFAULT_VEHICLE_ID) === bounds.vehicleId);
  }

  // Drive CSV Exporter. Readable.from applies backpressure and never builds the
  // complete export string in memory.
  fastify.get('/api/drives/:id/export/csv', async (request, reply) => {
    const { id } = request.params;
    const bounds = getDriveBounds(id);
    if (!bounds) return reply.status(404).send({ error: 'Drive session not found' });
    const records = driveRecords(bounds);
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename=drive_${id}_telemetry.csv`);
    return reply.send(Readable.from(driveCsvChunks(records)));
  });

  // Drive GPX Route Exporter
  fastify.get('/api/drives/:id/export/gpx', async (request, reply) => {
    const { id } = request.params;
    const bounds = getDriveBounds(id);
    if (!bounds) return reply.status(404).send({ error: 'Drive session not found' });
    const records = driveRecords(bounds);
    reply.header('Content-Type', 'application/gpx+xml');
    reply.header('Content-Disposition', `attachment; filename=drive_${id}_route.gpx`);
    return reply.send(Readable.from(driveGpxChunks(id, bounds, records, getRecordSpeed)));
  });
}

module.exports = exportRoutes;
