const Fastify = require('fastify');
const exportRoutes = require('./routes/export');

test('drive CSV appends fuel units, preserves zero and leaves legacy/null fields blank', async () => {
  const app = Fastify();
  const timestamp = 1700000000000;
  const records = [
    { timestamp, rpm: 1000, speed: 0, mafGps: 3.24, fuelSystemStatus: 2,
      estimatedFuelRateLph: 1.057959184, estimatedFuelEconomyKmL: 0 },
    { timestamp: timestamp + 1, speed: 60 },
    { timestamp: timestamp + 2, mafGps: null, fuelSystemStatus: null,
      estimatedFuelRateLph: null, estimatedFuelEconomyKmL: null },
    { timestamp: timestamp + 3, mafGps: 0, fuelSystemStatus: 0,
      estimatedFuelRateLph: 0, estimatedFuelEconomyKmL: 0 },
    { timestamp: timestamp + 4, vehicleId: 'another-car', estimatedFuelRateLph: 999 },
    { timestamp: timestamp + 99, estimatedFuelRateLph: 888 },
  ];
  await app.register(exportRoutes, {
    telemetryDataStore: records, DEFAULT_VEHICLE_ID: 'car', getRecordSpeed: r => r.speed ?? 0,
    getDriveBounds: id => id === 'fuel' ? {
      startTime: timestamp, endTime: timestamp + 4, vehicleId: 'car',
    } : null,
  });
  try {
    const response = await app.inject('/api/drives/fuel/export/csv');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/csv/);
    expect(response.headers['content-disposition']).toContain('drive_fuel_telemetry.csv');
    const [header, ...rows] = response.body.trimEnd().split('\n').map(line => line.split(','));
    expect(header.slice(0, 17)).toEqual([
      'Timestamp', 'Time', 'RPM', 'Speed', 'CoolantTemp', 'Latitude', 'Longitude', 'Altitude',
      'GPSSpeed', 'EngineLoad', 'ThrottlePos', 'FuelLevel', 'AmbientTemp', 'Voltage',
      'AccelTime', 'AlertCoolant', 'AlertVoltage',
    ]);
    expect(header.slice(17)).toEqual([
      'MAF (g/s)', 'FuelSystemStatus (code)', 'EstimatedFuelRate (L/h)', 'EstimatedFuelEconomy (km/L)',
    ]);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toHaveLength(header.length);
    expect(rows[0].slice(0, 4)).toEqual([String(timestamp), new Date(timestamp).toISOString(), '1000', '0']);
    expect(rows[0].slice(17)).toEqual(['3.24', '2', '1.057959184', '0']);
    expect(rows[1].slice(17)).toEqual(['', '', '', '']);
    expect(rows[2].slice(17)).toEqual(['', '', '', '']);
    expect(rows[3].slice(17)).toEqual(['0', '0', '0', '0']);
    expect((await app.inject('/api/drives/missing/export/csv')).statusCode).toBe(404);
  } finally { await app.close(); }
});
