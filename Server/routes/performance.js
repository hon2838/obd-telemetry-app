// Performance routes plugin: acceleration runs and personal records

async function performanceRoutes(fastify, options) {
  const {
    resolveVehicleQuery,
    cachedDrives,
    filterRecordsByScope,
    telemetryDataStore,
    DEFAULT_VEHICLE_ID,
    getRecordSpeed
  } = options;

  // GET all acceleration runs
  fastify.get('/api/performance/runs', async (request, reply) => {
    const vehicle = resolveVehicleQuery(request.query);
    if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });

    const drives = cachedDrives(vehicle, request.auth);
    const scopedStore = filterRecordsByScope(telemetryDataStore, request.auth, vehicle);
    const sortedRuns = scopedStore
      .filter(r => r.accelTime !== null && r.accelTime !== undefined && r.accelTime > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    const runs = [];
    let dIndex = 0;
    for (const r of sortedRuns) {
      const rVehicle = r.vehicleId || DEFAULT_VEHICLE_ID;
      while (dIndex < drives.length && drives[dIndex].endTime < r.timestamp) dIndex++;
      let drive = null;
      if (dIndex < drives.length && drives[dIndex].startTime <= r.timestamp && drives[dIndex].endTime >= r.timestamp
          && drives[dIndex].vehicleId === rVehicle) {
        drive = drives[dIndex];
      }
      runs.push({
        id: `${r.timestamp}-${Math.floor(r.accelTime * 100)}`,
        timestamp: r.timestamp,
        accelTime: r.accelTime,
        driveId: drive ? drive.id : null,
        maxSpeedReached: drive ? drive.summary.maxSpeed : 100
      });
    }
    return reply.send(runs.reverse());
  });

  // GET performance personal records
  fastify.get('/api/performance/records', async (request, reply) => {
    const vehicle = resolveVehicleQuery(request.query);
    if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });

    const drives = cachedDrives(vehicle, request.auth);
    const scopedStore = filterRecordsByScope(telemetryDataStore, request.auth, vehicle);

    const findDrive = (record) => {
      const ts = record.timestamp;
      const vid = record.vehicleId || DEFAULT_VEHICLE_ID;
      return drives.find(d => ts >= d.startTime && ts <= d.endTime && d.vehicleId === vid);
    };

    // 1. Find all runs with non-null accelTime
    const runs = scopedStore
      .filter(r => r.accelTime !== null && r.accelTime !== undefined && r.accelTime > 0);

    let bestRun = null;
    if (runs.length > 0) {
      const sortedRuns = [...runs].sort((a, b) => a.accelTime - b.accelTime);
      const r = sortedRuns[0];
      const drive = findDrive(r);
      bestRun = {
        time: r.accelTime,
        timestamp: r.timestamp,
        driveId: drive ? drive.id : null
      };
    }

    // 2. Top speed ever
    let topSpeed = null;
    const speedRecords = scopedStore
      .filter(r => getRecordSpeed(r) > 0)
      .sort((a, b) => getRecordSpeed(b) - getRecordSpeed(a));
    if (speedRecords.length > 0) {
      const r = speedRecords[0];
      const drive = findDrive(r);
      topSpeed = {
        speed: getRecordSpeed(r),
        timestamp: r.timestamp,
        driveId: drive ? drive.id : null
      };
    }

    // 3. Highest RPM ever
    let highestRpm = null;
    const rpmRecords = scopedStore
      .filter(r => r.rpm !== null && r.rpm !== undefined)
      .sort((a, b) => b.rpm - a.rpm);
    if (rpmRecords.length > 0 && rpmRecords[0].rpm > 0) {
      const r = rpmRecords[0];
      const drive = findDrive(r);
      highestRpm = {
        rpm: r.rpm,
        timestamp: r.timestamp,
        driveId: drive ? drive.id : null
      };
    }

    // 4. Longest Drive
    let longestDrive = null;
    if (drives.length > 0) {
      const sortedDrives = [...drives].sort((a, b) => b.summary.durationMin - a.summary.durationMin);
      const d = sortedDrives[0];
      longestDrive = {
        durationMin: d.summary.durationMin,
        driveId: d.id,
        date: new Date(d.startTime).toLocaleDateString()
      };
    }

    const totalDrivingTime = drives.reduce((acc, d) => acc + d.summary.durationMin, 0);

    return reply.send({
      best0to100: bestRun,
      topSpeed,
      highestRpm,
      longestDrive,
      totalDrivingTime,
      totalDrives: drives.length
    });
  });
}

module.exports = performanceRoutes;
