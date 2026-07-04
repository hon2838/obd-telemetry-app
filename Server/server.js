const fastify = require('fastify')({ logger: true })
const cors = require('@fastify/cors')
const fs = require('fs')
const path = require('path')

const DB_DIR = path.join(__dirname, 'data')
const DB_PATH = path.join(DB_DIR, 'telemetry.json')
const DIAG_PATH = path.join(DB_DIR, 'diagnostics.json')

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true })
}

// Load existing telemetry data or start fresh
let telemetryDataStore = []
if (fs.existsSync(DB_PATH)) {
  try {
    telemetryDataStore = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  } catch (err) {
    fastify.log.error('Error reading telemetry data file, starting with empty store:', err)
  }
}

// Load diagnostics or start fresh
let diagnosticsStore = {
  latestDtc: { code: "", timestamp: null },
  latestClearStatus: { success: null, timestamp: null }
}
if (fs.existsSync(DIAG_PATH)) {
  try {
    diagnosticsStore = JSON.parse(fs.readFileSync(DIAG_PATH, 'utf8'))
  } catch (err) {
    fastify.log.error('Error reading diagnostics file:', err)
  }
}

let pendingCommands = [];

// Helper to save telemetry data to disk
const saveToDisk = () => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(telemetryDataStore, null, 2))
  } catch (err) {
    fastify.log.error('Failed to write telemetry data to disk:', err)
  }
}

// Helper to save diagnostics to disk
const saveDiagnostics = () => {
  try {
    fs.writeFileSync(DIAG_PATH, JSON.stringify(diagnosticsStore, null, 2))
  } catch (err) {
    fastify.log.error('Failed to write diagnostics to disk:', err)
  }
}

fastify.register(cors, {
  origin: true
})

// Batch POST endpoint to ingest JSON arrays and return commands
fastify.post('/api/telemetry/batch', async (request, reply) => {
  try {
    const apiKey = request.headers['x-api-key'];
    if (apiKey !== 'SUPER_SECURE_OBD_APP_KEY_2026') {
      return reply.status(401).send({ error: 'Unauthorized: Invalid API Key' });
    }

    const payload = request.body;
    
    if (!Array.isArray(payload)) {
      return reply.status(400).send({ error: 'Payload must be an array of telemetry objects' });
    }

    payload.forEach(record => {
      telemetryDataStore.push({
        timestamp: record.timestamp,
        rpm: record.rpm,
        speed: record.speed,
        coolantTemp: record.coolantTemp,
        latitude: record.latitude,
        longitude: record.longitude,
        altitude: record.altitude,
        gpsSpeed: record.gpsSpeed,
        engineLoad: record.engineLoad,
        throttlePos: record.throttlePos,
        fuelLevel: record.fuelLevel,
        ambientTemp: record.ambientTemp,
        voltage: record.voltage,
        accelTime: record.accelTime,
        alertCoolant: record.alertCoolant,
        alertVoltage: record.alertVoltage,
        receivedAt: Date.now()
      });
    });

    saveToDisk();

    // Pull queued commands and clear
    const commandsToSend = [...pendingCommands];
    pendingCommands = [];

    return reply.status(201).send({ 
      success: true, 
      message: `Ingested ${payload.length} records successfully.`,
      commands: commandsToSend
    });

  } catch (err) {
    request.log.error(err)
    return reply.status(500).send({ error: 'Internal Server Error' })
  }
})

// Queue diagnostic command from Dashboard
fastify.post('/api/commands', async (request, reply) => {
  const { command } = request.body || {};
  if (!command || (command !== 'read_dtc' && command !== 'clear_dtc')) {
    return reply.status(400).send({ error: 'Invalid command. Must be read_dtc or clear_dtc' });
  }
  pendingCommands.push(command);
  return reply.send({ success: true, message: `Command ${command} queued.` });
})

// Endpoint to ingest DTC reads
fastify.post('/api/telemetry/dtc', async (request, reply) => {
  const { dtc, timestamp } = request.body || {};
  diagnosticsStore.latestDtc = { 
    code: dtc || "No trouble codes found", 
    timestamp: timestamp || Date.now() 
  };
  saveDiagnostics();
  return reply.send({ success: true });
})

// Endpoint to ingest DTC clears
fastify.post('/api/telemetry/dtc/clear', async (request, reply) => {
  const { success, timestamp } = request.body || {};
  diagnosticsStore.latestClearStatus = { 
    success: success ?? false, 
    timestamp: timestamp || Date.now() 
  };
  saveDiagnostics();
  return reply.send({ success: true });
})

// Fetch diagnostics status
fastify.get('/api/telemetry/dtc', async (request, reply) => {
  return reply.send(diagnosticsStore);
})

// Helper to calculate drive bounds
const getDriveBounds = (driveId) => {
  if (telemetryDataStore.length === 0) return null;
  const sorted = [...telemetryDataStore].sort((a, b) => a.timestamp - b.timestamp);
  
  const drives = [];
  let currentDrive = null;
  const GAP_THRESHOLD_MS = 5 * 60 * 1000;

  for (const record of sorted) {
    if (!currentDrive) {
      currentDrive = {
        id: 1,
        startTime: record.timestamp,
        endTime: record.timestamp,
      };
    } else if (record.timestamp - currentDrive.endTime > GAP_THRESHOLD_MS) {
      drives.push(currentDrive);
      currentDrive = {
        id: drives.length + 1,
        startTime: record.timestamp,
        endTime: record.timestamp,
      };
    } else {
      currentDrive.endTime = record.timestamp;
    }
  }
  if (currentDrive) {
    drives.push(currentDrive);
  }
  
  return drives.find(d => d.id === parseInt(driveId)) || null;
}

// Drive CSV Exporter
fastify.get('/api/drives/:id/export/csv', async (request, reply) => {
  const { id } = request.params;
  const bounds = getDriveBounds(id);
  if (!bounds) {
    return reply.status(404).send({ error: 'Drive session not found' });
  }

  const records = telemetryDataStore.filter(r => r.timestamp >= bounds.startTime && r.timestamp <= bounds.endTime);
  
  let csv = 'Timestamp,Time,RPM,Speed,CoolantTemp,Latitude,Longitude,Altitude,GPSSpeed,EngineLoad,ThrottlePos,FuelLevel,AmbientTemp,Voltage,AccelTime,AlertCoolant,AlertVoltage\n';
  
  records.forEach(r => {
    const timeStr = new Date(r.timestamp).toISOString();
    csv += `${r.timestamp},${timeStr},${r.rpm ?? ''},${r.speed ?? ''},${r.coolantTemp ?? ''},${r.latitude},${r.longitude},${r.altitude},${r.gpsSpeed},${r.engineLoad ?? ''},${r.throttlePos ?? ''},${r.fuelLevel ?? ''},${r.ambientTemp ?? ''},${r.voltage ?? ''},${r.accelTime ?? ''},${r.alertCoolant ? 'true' : 'false'},${r.alertVoltage ? 'true' : 'false'}\n`;
  });

  reply.header('Content-Type', 'text/csv');
  reply.header('Content-Disposition', `attachment; filename=drive_${id}_telemetry.csv`);
  return reply.send(csv);
})

// Drive GPX Route Exporter
fastify.get('/api/drives/:id/export/gpx', async (request, reply) => {
  const { id } = request.params;
  const bounds = getDriveBounds(id);
  if (!bounds) {
    return reply.status(404).send({ error: 'Drive session not found' });
  }

  const records = telemetryDataStore.filter(r => r.timestamp >= bounds.startTime && r.timestamp <= bounds.endTime);

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Axia Telemetry Core" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Drive #${id} Telemetry</name>
    <time>${new Date(bounds.startTime).toISOString()}</time>
  </metadata>
  <trk>
    <name>Drive #${id}</name>
    <trkseg>
`;

  records.forEach(r => {
    if (r.latitude !== 0 && r.longitude !== 0) {
      const timeStr = new Date(r.timestamp).toISOString();
      gpx += `      <trkpt lat="${r.latitude}" lon="${r.longitude}">
        <ele>${r.altitude}</ele>
        <time>${timeStr}</time>
        <extensions>
          <rpm>${r.rpm ?? 0}</rpm>
          <speed>${r.speed ?? 0}</speed>
          <temp>${r.coolantTemp ?? 0}</temp>
        </extensions>
      </trkpt>\n`;
    }
  });

  gpx += `    </trkseg>
  </trk>
</gpx>`;

  reply.header('Content-Type', 'application/gpx+xml');
  reply.header('Content-Disposition', `attachment; filename=drive_${id}_route.gpx`);
  return reply.send(gpx);
})

// Endpoint to detect and segment drives
fastify.get('/api/drives', async (request, reply) => {
  if (telemetryDataStore.length === 0) {
    return reply.send([]);
  }

  const sorted = [...telemetryDataStore].sort((a, b) => a.timestamp - b.timestamp);
  
  const drives = [];
  let currentDrive = null;
  const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes inactivity starts a new drive

  for (const record of sorted) {
    if (!currentDrive) {
      currentDrive = {
        id: 1,
        startTime: record.timestamp,
        endTime: record.timestamp,
        maxRpm: record.rpm,
        maxSpeed: record.speed,
        startLevel: record.fuelLevel,
        endLevel: record.fuelLevel,
        recordCount: 1
      };
    } else if (record.timestamp - currentDrive.endTime > GAP_THRESHOLD_MS) {
      drives.push(currentDrive);
      currentDrive = {
        id: drives.length + 1,
        startTime: record.timestamp,
        endTime: record.timestamp,
        maxRpm: record.rpm,
        maxSpeed: record.speed,
        startLevel: record.fuelLevel,
        endLevel: record.fuelLevel,
        recordCount: 1
      };
    } else {
      currentDrive.endTime = record.timestamp;
      currentDrive.maxRpm = Math.max(currentDrive.maxRpm, record.rpm);
      currentDrive.maxSpeed = Math.max(currentDrive.maxSpeed, record.speed);
      currentDrive.endLevel = record.fuelLevel;
      currentDrive.recordCount++;
    }
  }
  if (currentDrive) {
    drives.push(currentDrive);
  }

  const formattedDrives = drives.map(drive => {
    const durationMin = Math.round((drive.endTime - drive.startTime) / 60000);
    const startStr = new Date(drive.startTime).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const fuelUsed = Math.max(0, drive.startLevel - drive.endLevel);
    return {
      id: drive.id,
      startTime: drive.startTime,
      endTime: drive.endTime,
      label: `Drive #${drive.id} - ${startStr} (${durationMin} min, ${drive.recordCount} pts)`,
      summary: {
        durationMin,
        maxRpm: drive.maxRpm,
        maxSpeed: drive.maxSpeed,
        fuelUsedPercent: fuelUsed.toFixed(1),
        pointCount: drive.recordCount
      }
    };
  });

  return reply.send(formattedDrives.reverse()); // Newest drives first
})

// Endpoint for the frontend dashboard to fetch data
fastify.get('/api/telemetry/history', async (request, reply) => {
  const { start, end } = request.query;
  if (start && end) {
    const startTime = parseInt(start);
    const endTime = parseInt(end);
    const filtered = telemetryDataStore.filter(record => record.timestamp >= startTime && record.timestamp <= endTime);
    return reply.send(filtered);
  }
  // Return the last 1000 records for rendering
  const history = telemetryDataStore.slice(-1000);
  return reply.send(history);
})

// Run the server!
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' })
    fastify.log.info(`Server listening on ${fastify.server.address().port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}
start()
