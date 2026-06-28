const fastify = require('fastify')({ logger: true })
const cors = require('@fastify/cors')
const fs = require('fs')
const path = require('path')

const DB_DIR = path.join(__dirname, 'data')
const DB_PATH = path.join(DB_DIR, 'telemetry.json')

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

// Helper to save telemetry data to disk
const saveToDisk = () => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(telemetryDataStore, null, 2))
  } catch (err) {
    fastify.log.error('Failed to write telemetry data to disk:', err)
  }
}

fastify.register(cors, {
  origin: true
})

// Batch POST endpoint to ingest JSON arrays
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

    // In a real app, insert this batch into a timeseries DB like InfluxDB or TimescaleDB
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
        receivedAt: Date.now()
      });
    });

    saveToDisk();

    return reply.status(201).send({ 
      success: true, 
      message: `Ingested ${payload.length} records successfully.` 
    });

  } catch (err) {
    request.log.error(err)
    return reply.status(500).send({ error: 'Internal Server Error' })
  }
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
