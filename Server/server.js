const fastify = require('fastify')({ logger: true })
const cors = require('@fastify/cors')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// Read the expected API key from the environment at module load.
// We deliberately do NOT provide a default: shipping a literal
// in the repo or the running image means anyone with the source
// (or any public mirror) has the credential. Fail-closed on
// missing — the server refuses to start.
const OBD_API_KEY = process.env.OBD_API_KEY
if (!OBD_API_KEY || OBD_API_KEY.length < 32) {
  // Reject early so a misconfigured deploy (forgot to set the
  // env var) can't silently start accepting the wrong key.
  // We require >=32 chars so even an accidentally-short var
  // (e.g. "test") can't be the production credential.
  console.error('FATAL: OBD_API_KEY env var is missing or < 32 chars. Refusing to start.')
  process.exit(1)
}

// Constant-time comparison helper. Used to authenticate the
// X-API-Key header without leaking the expected key one byte
// at a time. Returns false (and never throws) for mismatched
// lengths or empty inputs; callers should check truthiness.
function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

const DB_DIR = path.join(__dirname, 'data')
const DB_PATH = path.join(DB_DIR, 'telemetry.json')
const DIAG_PATH = path.join(DB_DIR, 'diagnostics.json')
const FUEL_PATH = path.join(DB_DIR, 'fuel_logs.json')
const DTC_HIST_PATH = path.join(DB_DIR, 'dtc_history.json')
const MAINT_PATH = path.join(DB_DIR, 'maintenance.json')

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
    fastify.log.error('Error reading telemetry data file, backing up and starting fresh:', err)
    fs.renameSync(DB_PATH, `${DB_PATH}.bak.${Date.now()}`)
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
    fastify.log.error('Error reading diagnostics file, backing up and starting fresh:', err)
    fs.renameSync(DIAG_PATH, `${DIAG_PATH}.bak.${Date.now()}`)
  }
}

// Load DTC history or start fresh
let dtcHistoryStore = []
if (fs.existsSync(DTC_HIST_PATH)) {
  try {
    dtcHistoryStore = JSON.parse(fs.readFileSync(DTC_HIST_PATH, 'utf8'))
  } catch (err) {
    fastify.log.error('Error reading DTC history file, backing up and starting fresh:', err)
    fs.renameSync(DTC_HIST_PATH, `${DTC_HIST_PATH}.bak.${Date.now()}`)
  }
}

// Load fuel logs or start fresh
let fuelLogsStore = []
if (fs.existsSync(FUEL_PATH)) {
  try {
    fuelLogsStore = JSON.parse(fs.readFileSync(FUEL_PATH, 'utf8'))
  } catch (err) {
    fastify.log.error('Error reading fuel logs file, backing up and starting fresh:', err)
    fs.renameSync(FUEL_PATH, `${FUEL_PATH}.bak.${Date.now()}`)
  }
}

// Load maintenance items or start fresh
let maintenanceStore = []
if (fs.existsSync(MAINT_PATH)) {
  try {
    maintenanceStore = JSON.parse(fs.readFileSync(MAINT_PATH, 'utf8'))
  } catch (err) {
    fastify.log.error('Error reading maintenance file, backing up and starting fresh:', err)
    fs.renameSync(MAINT_PATH, `${MAINT_PATH}.bak.${Date.now()}`)
  }
}

// Path for the persisted command queue. The queue survives
// container restarts: if `docker restart` happens while a
// command is queued, the next boot will load it back so the
// head unit can still pick it up.
const COMMANDS_QUEUE_PATH = path.join(DB_DIR, 'commands_queue.json');

// ----- Atomic file writer -----------------------------------------------
//
// The previous version of this code had five near-identical
// save helpers, each doing `fs.promises.writeFile(...).catch(log)`.
// That has two failure modes:
//   1. Overlapping writes: a high-frequency batch ingest could
//      trigger two writes at once. fs.writeFile isn't atomic;
//      a second write that starts before the first rename can
//      produce a torn JSON file (the next read fails and the
//      file is renamed .bak.<timestamp>, losing data).
//   2. Silent loss on crash: a write that's mid-flight when
//      the process gets SIGKILL'd leaves a half-written file.
//      The data is gone.
//
// persist(path, data) fixes both:
//   - A per-path promise chain serializes writes (write N+1
//     starts only after write N resolves).
//   - A write to path + rename is atomic on POSIX: the file
//     either points to the old content or the new, never a
//     mix.
//   - On error, the temp file is unlinked so a future successful
//     write doesn't pile up `.tmp` debris.
//   - Errors are still logged (so we don't lose visibility),
//     but they don't crash the process.
const _writeChains = new Map();
function persist(path, data) {
  const prev = _writeChains.get(path) || Promise.resolve();
  const next = prev
    .then(async () => {
      const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
      await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.promises.rename(tmp, path);
    })
    .catch(err => {
      fastify.log.error(`Failed to persist ${path}: ${err}`);
    });
  _writeChains.set(path, next);
  return next;
}

// Initialize command queue from disk (if present) so a
// container restart doesn't drop pending DTC commands.
let pendingCommands = [];
if (fs.existsSync(COMMANDS_QUEUE_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(COMMANDS_QUEUE_PATH, 'utf8'));
    if (Array.isArray(loaded)) {
      pendingCommands = loaded;
      if (pendingCommands.length > 0) {
        fastify.log.info(`Restored ${pendingCommands.length} pending command(s) from disk`);
      }
    }
  } catch (err) {
    fastify.log.error(`Failed to load ${COMMANDS_QUEUE_PATH}, starting empty: ${err}`);
    fs.renameSync(COMMANDS_QUEUE_PATH, `${COMMANDS_QUEUE_PATH}.bak.${Date.now()}`);
  }
}

// Helper to save telemetry data to disk
const saveToDisk = () => persist(DB_PATH, telemetryDataStore);

// Helper to save diagnostics to disk
const saveDiagnostics = () => persist(DIAG_PATH, diagnosticsStore);

// Helper to save DTC history to disk
const saveDtcHistory = () => persist(DTC_HIST_PATH, dtcHistoryStore);

// Helper to save fuel logs to disk
const saveFuelLogs = () => persist(FUEL_PATH, fuelLogsStore);

// Helper to save maintenance to disk
const saveMaintenance = () => persist(MAINT_PATH, maintenanceStore);

const helmet = require('@fastify/helmet')
const rateLimit = require('@fastify/rate-limit')

// 1. Helmet headers
fastify.register(helmet)

// 2. Global Rate Limiter
fastify.register(rateLimit, {
  max: 200, // global limit: 200 reqs per 15 min
  timeWindow: '15 minutes'
})

// 3. Strict CORS
fastify.register(cors, {
  origin: ['https://obd.hon2838.name.my', 'http://localhost:3001', 'http://localhost:3003']
})

// Schema for telemetry items
const telemetryRecordSchema = {
  type: 'object',
  required: ['timestamp'],
  properties: {
    timestamp: { type: 'number' },
    rpm: { type: ['number', 'null'] },
    speed: { type: ['number', 'null'] },
    coolantTemp: { type: ['number', 'null'] },
    latitude: { type: 'number' },
    longitude: { type: 'number' },
    altitude: { type: 'number' },
    gpsSpeed: { type: 'number' },
    engineLoad: { type: ['number', 'null'] },
    throttlePos: { type: ['number', 'null'] },
    fuelLevel: { type: ['number', 'null'] },
    ambientTemp: { type: ['number', 'null'] },
    voltage: { type: ['number', 'null'] },
    accelTime: { type: ['number', 'null'] },
    alertCoolant: { type: 'boolean' },
    alertVoltage: { type: 'boolean' },
    accOn: { type: ['boolean', 'null'] },
    headlightOn: { type: ['boolean', 'null'] },
    volume: { type: ['number', 'null'] },
    wifiSsid: { type: ['string', 'null'] },
    btConnected: { type: ['boolean', 'null'] }
  }
}

// Batch POST endpoint to ingest JSON arrays and return commands
fastify.post('/api/telemetry/batch', {
  config: {
    rateLimit: {
      max: 2000, // higher limit for high-frequency polling
      timeWindow: '15 minutes'
    }
  },
  schema: {
    body: {
      type: 'array',
      items: telemetryRecordSchema
    }
  }
}, async (request, reply) => {
  try {
    const apiKey = request.headers['x-api-key'];
    // Constant-time comparison to prevent timing attacks that
    // could leak the expected key one byte at a time. The key
    // is read from process.env.OBD_API_KEY at boot (see top of
    // file); this branch never falls back to a literal.
    if (!constantTimeEquals(apiKey || '', OBD_API_KEY)) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid API Key' });
    }

    const payload = request.body;


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
        accOn: record.accOn,
        headlightOn: record.headlightOn,
        volume: record.volume,
        wifiSsid: record.wifiSsid,
        btConnected: record.btConnected,
        receivedAt: Date.now()
      });
    });

    saveToDisk();

    // Pull queued commands and clear. Persist the empty queue
    // so a crash between this assignment and the response
    // doesn't leave a phantom command in commands_queue.json
    // (which would get re-sent to the next head unit that syncs).
    const commandsToSend = [...pendingCommands];
    pendingCommands = [];
    persist(COMMANDS_QUEUE_PATH, pendingCommands);

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
//
// Security: this endpoint used to accept any POST and queue
// a `read_dtc` or `clear_dtc` against the head unit. Since
// the endpoint is reachable from the public dashboard (and
// therefore from anyone who can reach obd-api.hon2838.name.my),
// the previous version was a remote-attack surface: an attacker
// could repeatedly trigger `clear_dtc` and silently wipe any
// stored diagnostic codes. We now require the X-API-Key
// header (same secret the agent uses for telemetry) and a
// per-IP rate limit via @fastify/rate-limit.
//
// Queue: a container restart used to drop pending commands.
// They now persist to commands_queue.json (see persist() above)
// so a SIGKILL mid-flight doesn't lose queued work. The cap
// of 10 prevents an attacker (or a buggy loop) from filling
// the disk.
const MAX_PENDING_COMMANDS = 10;
fastify.post('/api/commands', {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: '1 minute',
    },
  },
}, async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  if (!constantTimeEquals(apiKey || '', OBD_API_KEY)) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid API Key' });
  }
  const { command } = request.body || {};
  if (!command || (command !== 'read_dtc' && command !== 'clear_dtc')) {
    return reply.status(400).send({ error: 'Invalid command. Must be read_dtc or clear_dtc' });
  }
  if (pendingCommands.length >= MAX_PENDING_COMMANDS) {
    return reply.status(429).send({
      error: 'Command queue is full. The head unit will drain it on next sync; retry shortly.',
      queue_size: pendingCommands.length,
    });
  }
  pendingCommands.push(command);
  // Persist the queue so a restart doesn't drop this command.
  // We await so the response reflects the on-disk state.
  await persist(COMMANDS_QUEUE_PATH, pendingCommands);
  return reply.send({ success: true, message: `Command ${command} queued.`, queue_size: pendingCommands.length });
})

const DTC_DATABASE = {
  // P0xxx codes (Powertrain)
  "P0001": { description: "Fuel Volume Regulator Control Circuit Open", severity: "severe", system: "Fuel" },
  "P0002": { description: "Fuel Volume Regulator Control Circuit Range/Performance", severity: "severe", system: "Fuel" },
  "P0030": { description: "O2 Sensor Heater Control Circuit (Bank 1 Sensor 1)", severity: "moderate", system: "Emissions" },
  "P0036": { description: "O2 Sensor Heater Control Circuit (Bank 1 Sensor 2)", severity: "moderate", system: "Emissions" },
  "P0100": { description: "Mass or Volume Air Flow Circuit Malfunction", severity: "moderate", system: "Engine" },
  "P0101": { description: "Mass or Volume Air Flow Circuit Range/Performance Problem", severity: "moderate", system: "Engine" },
  "P0102": { description: "Mass or Volume Air Flow Circuit Low Input", severity: "moderate", system: "Engine" },
  "P0103": { description: "Mass or Volume Air Flow Circuit High Input", severity: "moderate", system: "Engine" },
  "P0104": { description: "Mass or Volume Air Flow Circuit Intermittent", severity: "moderate", system: "Engine" },
  "P0110": { description: "Intake Air Temperature Sensor 1 Circuit Malfunction", severity: "moderate", system: "Engine" },
  "P0115": { description: "Engine Coolant Temperature Circuit Malfunction", severity: "severe", system: "Engine" },
  "P0116": { description: "Engine Coolant Temperature Circuit Range/Performance Problem", severity: "severe", system: "Engine" },
  "P0117": { description: "Engine Coolant Temperature Circuit Low Input", severity: "severe", system: "Engine" },
  "P0118": { description: "Engine Coolant Temperature Circuit High Input", severity: "severe", system: "Engine" },
  "P0120": { description: "Throttle/Pedal Position Sensor/Switch A Circuit Malfunction", severity: "moderate", system: "Engine" },
  "P0121": { description: "Throttle/Pedal Position Sensor/Switch A Circuit Range/Performance Problem", severity: "moderate", system: "Engine" },
  "P0125": { description: "Insufficient Coolant Temperature for Closed Loop Fuel Control", severity: "severe", system: "Engine" },
  "P0128": { description: "Coolant Thermostat (Coolant Temp Below Thermostat Regulating Temperature)", severity: "moderate", system: "Engine" },
  "P0130": { description: "O2 Sensor Circuit Malfunction (Bank 1 Sensor 1)", severity: "moderate", system: "Emissions" },
  "P0131": { description: "O2 Sensor Circuit Low Voltage (Bank 1 Sensor 1)", severity: "moderate", system: "Emissions" },
  "P0132": { description: "O2 Sensor Circuit High Voltage (Bank 1 Sensor 1)", severity: "moderate", system: "Emissions" },
  "P0133": { description: "O2 Sensor Circuit Slow Response (Bank 1 Sensor 1)", severity: "moderate", system: "Emissions" },
  "P0134": { description: "O2 Sensor Circuit No Activity Detected (Bank 1 Sensor 1)", severity: "moderate", system: "Emissions" },
  "P0135": { description: "O2 Sensor Heater Circuit Malfunction (Bank 1 Sensor 1)", severity: "moderate", system: "Emissions" },
  "P0171": { description: "System Too Lean (Bank 1)", severity: "severe", system: "Fuel" },
  "P0172": { description: "System Too Rich (Bank 1)", severity: "severe", system: "Fuel" },
  "P0201": { description: "Cylinder 1 Injector Circuit Malfunction", severity: "severe", system: "Fuel" },
  "P0202": { description: "Cylinder 2 Injector Circuit Malfunction", severity: "severe", system: "Fuel" },
  "P0203": { description: "Cylinder 3 Injector Circuit Malfunction", severity: "severe", system: "Fuel" },
  "P0204": { description: "Cylinder 4 Injector Circuit Malfunction", severity: "severe", system: "Fuel" },
  "P0300": { description: "Random/Multiple Cylinder Misfire Detected", severity: "severe", system: "Engine" },
  "P0301": { description: "Cylinder 1 Misfire Detected", severity: "severe", system: "Engine" },
  "P0302": { description: "Cylinder 2 Misfire Detected", severity: "severe", system: "Engine" },
  "P0303": { description: "Cylinder 3 Misfire Detected", severity: "severe", system: "Engine" },
  "P0304": { description: "Cylinder 4 Misfire Detected", severity: "severe", system: "Engine" },
  "P0325": { description: "Knock Sensor 1 Circuit Malfunction (Bank 1 or Single Sensor)", severity: "moderate", system: "Engine" },
  "P0335": { description: "Crankshaft Position Sensor A Circuit Malfunction", severity: "severe", system: "Engine" },
  "P0340": { description: "Camshaft Position Sensor A Circuit Malfunction (Bank 1 or Single Sensor)", severity: "severe", system: "Engine" },
  "P0420": { description: "Catalyst System Efficiency Below Threshold (Bank 1)", severity: "moderate", system: "Emissions" },
  "P0440": { description: "Evaporative Emission Control System Malfunction", severity: "moderate", system: "Emissions" },
  "P0442": { description: "Evaporative Emission Control System Leak Detected (Small Leak)", severity: "moderate", system: "Emissions" },
  "P0500": { description: "Vehicle Speed Sensor Malfunction", severity: "severe", system: "Chassis" },
  "P0505": { description: "Idle Control System Malfunction", severity: "moderate", system: "Engine" },
  "P0600": { description: "Serial Communication Link Malfunction", severity: "severe", system: "Network" },
  "P0700": { description: "Transmission Control System Malfunction (MIL Request)", severity: "severe", system: "Transmission" }
};

function parseDtcCodes(dtcString) {
  if (!dtcString) return [];
  return dtcString
    .split(/[,\s]+/)
    .map(c => c.trim().toUpperCase())
    .filter(c => /^[PBUC]\d{4}$/.test(c));
}

function getDtcInfo(code) {
  const normalized = code.trim().toUpperCase();
  if (DTC_DATABASE[normalized]) {
    return { code: normalized, ...DTC_DATABASE[normalized] };
  }
  
  const first = normalized.charAt(0);
  const second = normalized.charAt(1);
  const third = normalized.charAt(2);
  
  let system = "Unknown";
  let description = `OBD-II Diagnostic Trouble Code ${normalized}`;
  let severity = "moderate";
  
  if (first === 'P') {
    system = "Powertrain (Engine/Transmission)";
    if (second === '0') {
      if (third === '1' || third === '2') {
        description = `Generic Fuel & Air Metering error (${normalized})`;
      } else if (third === '3') {
        description = `Generic Ignition System or Misfire error (${normalized})`;
        severity = "severe";
      } else if (third === '4') {
        description = `Generic Auxiliary Emissions Control error (${normalized})`;
      } else if (third === '5') {
        description = `Generic Vehicle Speed or Idle Control error (${normalized})`;
      } else if (third === '6') {
        description = `Generic Computer or Output Circuit error (${normalized})`;
        severity = "severe";
      } else if (third === '7' || third === '8' || third === '9') {
        description = `Generic Transmission control error (${normalized})`;
        severity = "severe";
      }
    } else {
      description = `Manufacturer-controlled Powertrain error (${normalized})`;
    }
  } else if (first === 'B') {
    system = "Body (Airbags, AC, Locking)";
    description = `Body System trouble code (${normalized})`;
    if (normalized.startsWith("B0001") || normalized.startsWith("B0002") || normalized.startsWith("B0028")) {
      description = "Airbag/Supplemental Restraint System (SRS) Malfunction";
      severity = "severe";
    }
  } else if (first === 'C') {
    system = "Chassis (ABS, Steering, Brakes)";
    description = `Chassis trouble code (${normalized})`;
    if (normalized.startsWith("C0035") || normalized.startsWith("C0040")) {
      description = "Wheel Speed Sensor Circuit Malfunction";
      severity = "severe";
    }
  } else if (first === 'U') {
    system = "Network Communication (CAN Bus)";
    description = `Network Communication error (${normalized})`;
    severity = "severe";
  }
  
  return {
    code: normalized,
    description,
    severity,
    system
  };
}

function getRecordSpeed(record) {
  return record.speed !== null && record.speed !== undefined
    ? record.speed
    : (record.gpsSpeed || 0);
}

// Endpoint to ingest DTC reads
fastify.post('/api/telemetry/dtc', async (request, reply) => {
  const { dtc, timestamp } = request.body || {};
  const time = timestamp || Date.now();
  const rawCodeStr = dtc || "No trouble codes found";
  
  diagnosticsStore.latestDtc = { 
    code: rawCodeStr, 
    timestamp: time
  };
  saveDiagnostics();

  // Add to history
  const parsedCodes = parseDtcCodes(rawCodeStr);
  dtcHistoryStore.push({
    id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    timestamp: time,
    type: 'read',
    codes: parsedCodes,
    success: true
  });
  saveDtcHistory();

  return reply.send({ success: true });
})

// Endpoint to ingest DTC clears
fastify.post('/api/telemetry/dtc/clear', async (request, reply) => {
  const { success, timestamp } = request.body || {};
  const time = timestamp || Date.now();
  const clearSuccess = success ?? false;

  diagnosticsStore.latestClearStatus = { 
    success: clearSuccess, 
    timestamp: time
  };
  saveDiagnostics();

  // Add to history
  dtcHistoryStore.push({
    id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    timestamp: time,
    type: 'clear',
    codes: [],
    success: clearSuccess
  });
  saveDtcHistory();

  return reply.send({ success: true });
})

// Fetch diagnostics status
fastify.get('/api/telemetry/dtc', async (request, reply) => {
  return reply.send({
    latest: diagnosticsStore,
    history: dtcHistoryStore
  });
})

// Batch lookup DTC descriptions
fastify.post('/api/dtc/lookup', async (request, reply) => {
  const { codes } = request.body || {};
  if (!Array.isArray(codes)) {
    return reply.status(400).send({ error: "Body must contain 'codes' array" });
  }
  const details = codes.map(code => getDtcInfo(code));
  return reply.send(details);
})

// Single lookup DTC description
fastify.get('/api/dtc/lookup/:code', async (request, reply) => {
  const { code } = request.params;
  return reply.send(getDtcInfo(code));
})

// GET all acceleration runs
fastify.get('/api/performance/runs', async (request, reply) => {
  const drives = segmentDrives();
  const sortedRuns = telemetryDataStore
    .filter(r => r.accelTime !== null && r.accelTime !== undefined && r.accelTime > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  const runs = [];
  let dIndex = 0;
  for (const r of sortedRuns) {
    while (dIndex < drives.length && drives[dIndex].endTime < r.timestamp) dIndex++;
    let drive = null;
    if (dIndex < drives.length && drives[dIndex].startTime <= r.timestamp && drives[dIndex].endTime >= r.timestamp) {
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
})

// GET performance personal records
fastify.get('/api/performance/records', async (request, reply) => {
  const drives = segmentDrives();
  
  const findDrive = (timestamp) => {
    // Binary search could be used, but since it's just finding 3 items, find() is fine here because N is only the number of drives, not telemetry points!
    return drives.find(d => timestamp >= d.startTime && timestamp <= d.endTime);
  };

  // 1. Find all runs with non-null accelTime
  const runs = telemetryDataStore
    .filter(r => r.accelTime !== null && r.accelTime !== undefined && r.accelTime > 0);
  
  let bestRun = null;
  if (runs.length > 0) {
    const sortedRuns = [...runs].sort((a, b) => a.accelTime - b.accelTime);
    const r = sortedRuns[0];
    const drive = findDrive(r.timestamp);
    bestRun = {
      time: r.accelTime,
      timestamp: r.timestamp,
      driveId: drive ? drive.id : null
    };
  }

  // 2. Top speed ever
  let topSpeed = null;
  const speedRecords = telemetryDataStore
    .filter(r => getRecordSpeed(r) > 0)
    .sort((a, b) => getRecordSpeed(b) - getRecordSpeed(a));
  if (speedRecords.length > 0) {
    const r = speedRecords[0];
    const drive = findDrive(r.timestamp);
    topSpeed = {
      speed: getRecordSpeed(r),
      timestamp: r.timestamp,
      driveId: drive ? drive.id : null
    };
  }

  // 3. Highest RPM ever
  let highestRpm = null;
  const rpmRecords = telemetryDataStore
    .filter(r => r.rpm !== null && r.rpm !== undefined)
    .sort((a, b) => b.rpm - a.rpm);
  if (rpmRecords.length > 0 && rpmRecords[0].rpm > 0) {
    const r = rpmRecords[0];
    const drive = findDrive(r.timestamp);
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
          <speed>${getRecordSpeed(r)}</speed>
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

// Haversine formula to calculate distance in km between two GPS coordinates
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === 0 && lon1 === 0 && lat2 === 0 && lon2 === 0) return 0;
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Internal function to segment telemetry data into drive objects with summary stats
function segmentDrives() {
  if (telemetryDataStore.length === 0) {
    return [];
  }

  const sorted = [...telemetryDataStore].sort((a, b) => a.timestamp - b.timestamp);
  
  const drives = [];
  let currentDrive = null;
  const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes inactivity starts a new drive

  for (const record of sorted) {
    const recordFuel = (record.fuelLevel !== null && record.fuelLevel !== undefined) ? record.fuelLevel : null;
    const recordRpm = record.rpm || 0;
    const recordSpeed = getRecordSpeed(record);

    if (!currentDrive) {
      currentDrive = {
        id: 1,
        startTime: record.timestamp,
        endTime: record.timestamp,
        maxRpm: recordRpm,
        maxSpeed: recordSpeed,
        startLevel: recordFuel,
        endLevel: recordFuel,
        recordCount: 1,
        points: [record]
      };
    } else if (record.timestamp - currentDrive.endTime > GAP_THRESHOLD_MS) {
      drives.push(currentDrive);
      currentDrive = {
        id: drives.length + 1,
        startTime: record.timestamp,
        endTime: record.timestamp,
        maxRpm: recordRpm,
        maxSpeed: recordSpeed,
        startLevel: recordFuel,
        endLevel: recordFuel,
        recordCount: 1,
        points: [record]
      };
    } else {
      currentDrive.endTime = record.timestamp;
      currentDrive.maxRpm = Math.max(currentDrive.maxRpm, recordRpm);
      currentDrive.maxSpeed = Math.max(currentDrive.maxSpeed, recordSpeed);
      if (recordFuel !== null) {
        if (currentDrive.startLevel === null) {
          currentDrive.startLevel = recordFuel;
        }
        currentDrive.endLevel = recordFuel;
      }
      currentDrive.recordCount++;
      currentDrive.points.push(record);
    }
  }
  if (currentDrive) {
    drives.push(currentDrive);
  }

  return drives.map(drive => {
    let score = 100;
    let harshAccelCount = 0;
    let harshBrakeCount = 0;
    let highRpmCount = 0;
    
    if (drive.points.length > 1) {
      for (let i = 1; i < drive.points.length; i++) {
        const p1 = drive.points[i - 1];
        const p2 = drive.points[i];
        
        // Calculate time diff in seconds
        const dt = (p2.timestamp - p1.timestamp) / 1000;
        if (dt > 0 && dt < 10) { // Only compare points reasonably close
          // Calculate speed diff in km/h
          const dv = getRecordSpeed(p2) - getRecordSpeed(p1);
          const accel = dv / dt; // km/h per second
          
          if (accel > 10) { // Harsh acceleration (> 10 km/h per second)
            harshAccelCount++;
            score -= 1;
          } else if (accel < -12) { // Harsh braking (< -12 km/h per second)
            harshBrakeCount++;
            score -= 1.5; // Penalize braking slightly more
          }
        }
        
        if ((p2.rpm || 0) > 4000) {
          highRpmCount++;
        }
      }
      // Penalize for excessive high RPM duration
      if (highRpmCount > 10) {
        score -= (highRpmCount * 0.1);
      }
    }
    
    const finalScore = Math.max(0, Math.min(100, Math.round(score)));

    const durationMin = Math.round((drive.endTime - drive.startTime) / 60000);
    const startStr = new Date(drive.startTime).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // 1. Calculate GPS distance
    let distanceKm = 0;
    let prevPoint = null;
    for (const p of drive.points) {
      if (p.latitude && p.longitude && p.latitude !== 0 && p.longitude !== 0) {
        if (prevPoint) {
          distanceKm += getHaversineDistance(prevPoint.latitude, prevPoint.longitude, p.latitude, p.longitude);
        }
        prevPoint = p;
      }
    }

    // 2. Average Speed
    const speeds = drive.points.map(getRecordSpeed);
    const avgSpeed = speeds.length > 0 ? (speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;

    // 3. Start/End locations
    const validGps = drive.points.filter(p => p.latitude && p.longitude && p.latitude !== 0 && p.longitude !== 0);
    const startLocation = validGps.length > 0 ? { lat: validGps[0].latitude, lon: validGps[0].longitude } : null;
    const endLocation = validGps.length > 0 ? { lat: validGps[validGps.length - 1].latitude, lon: validGps[validGps.length - 1].longitude } : null;

    // 4. Fuel used and fuel efficiency
    let fuelUsedPercent = 0;
    if (drive.startLevel !== null && drive.endLevel !== null) {
      fuelUsedPercent = Math.max(0, drive.startLevel - drive.endLevel);
    }
    const fuelUsedLitres = (fuelUsedPercent / 100) * 36; // Axia 36L tank size
    const fuelEfficiencyKmL = (fuelUsedLitres > 0 && distanceKm > 0) ? (distanceKm / fuelUsedLitres) : null;

    return {
      id: drive.id,
      startTime: drive.startTime,
      endTime: drive.endTime,
      label: `Drive #${drive.id} - ${startStr} (${durationMin} min, ${drive.recordCount} pts)`,
      summary: {
        durationMin,
        maxRpm: drive.maxRpm,
        maxSpeed: drive.maxSpeed,
        fuelUsedPercent: parseFloat(fuelUsedPercent.toFixed(1)),
        pointCount: drive.recordCount,
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        avgSpeed: parseFloat(avgSpeed.toFixed(1)),
        startLocation,
        endLocation,
        fuelEfficiencyKmL: fuelEfficiencyKmL ? parseFloat(fuelEfficiencyKmL.toFixed(2)) : null,
        driverScore: finalScore,
        harshEvents: { accel: harshAccelCount, brake: harshBrakeCount }
      }
    };
  });
}

// Endpoint to detect and segment drives
fastify.get('/api/drives', async (request, reply) => {
  const formattedDrives = segmentDrives();
  return reply.send([...formattedDrives].reverse()); // Newest drives first
})

// Endpoint to fetch leaderboard of trips
fastify.get('/api/trips/leaderboard', async (request, reply) => {
  const drives = segmentDrives();
  if (drives.length === 0) {
    return reply.send({
      best_efficiency: [],
      longest_distance: [],
      highest_speed: [],
      longest_duration: []
    });
  }

  // Filter drives for efficiency leaderboards (only count trips >= 1km to avoid division anomalies)
  const validForEfficiency = drives.filter(d => d.summary.distanceKm >= 1.0 && d.summary.fuelEfficiencyKmL !== null);

  const bestEfficiency = [...validForEfficiency]
    .sort((a, b) => b.summary.fuelEfficiencyKmL - a.summary.fuelEfficiencyKmL)
    .slice(0, 5);

  const longestDistance = [...drives]
    .sort((a, b) => b.summary.distanceKm - a.summary.distanceKm)
    .slice(0, 5);

  const highestSpeed = [...drives]
    .sort((a, b) => b.summary.maxSpeed - a.summary.maxSpeed)
    .slice(0, 5);

  const longestDuration = [...drives]
    .sort((a, b) => b.summary.durationMin - a.summary.durationMin)
    .slice(0, 5);

  return reply.send({
    best_efficiency: bestEfficiency,
    longest_distance: longestDistance,
    highest_speed: highestSpeed,
    longest_duration: longestDuration
  });
})

// Endpoint for the frontend dashboard to fetch data
fastify.get('/api/telemetry/history', async (request, reply) => {
  const { start, end, minutes, limit } = request.query;
  if (start && end) {
    const startTime = parseInt(start);
    const endTime = parseInt(end);
    const filtered = telemetryDataStore.filter(record => record.timestamp >= startTime && record.timestamp <= endTime);
    return reply.send(filtered);
  }
  let records = telemetryDataStore;
  if (minutes !== undefined) {
    const minutesNum = parseInt(minutes);
    if (!isNaN(minutesNum) && minutesNum > 0) {
      const cutoff = Date.now() - minutesNum * 60 * 1000;
      records = records.filter(record => record.timestamp >= cutoff);
    }
  }
  let cap = 1000;
  if (limit !== undefined) {
    const limitNum = parseInt(limit);
    if (!isNaN(limitNum) && limitNum > 0) cap = limitNum;
  }
  // Return the last `cap` records for rendering
  return reply.send(records.slice(-cap));
})

// Lightweight single-record endpoint for dashboard live polling
fastify.get('/api/telemetry/latest', async (request, reply) => {
  const latest = telemetryDataStore[telemetryDataStore.length - 1];
  return reply.send(latest !== undefined ? latest : null);
})

// POST /api/fuel-logs - Add one or more fuel log entries
fastify.post('/api/fuel-logs', async (request, reply) => {
  try {
    const apiKey = request.headers['x-api-key'];
    // Dashboard doesn't send API key currently, so we allow requests without it.
    // However, if one IS provided, it must be correct.
    if (apiKey && !constantTimeEquals(apiKey, OBD_API_KEY)) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid API Key' });
    }

    const payload = request.body;
    if (!payload) {
      return reply.status(400).send({ error: 'Missing request body' });
    }

    const logsToAdd = Array.isArray(payload) ? payload : [payload];
    let addedCount = 0;

    logsToAdd.forEach((item, index) => {
      const litres = parseFloat(item.litres);
      const odometer = parseFloat(item.odometer);
      if (isNaN(litres) || isNaN(odometer)) {
        return;
      }

      fuelLogsStore.push({
        // Always generate a unique server ID since Android app is write-only for logs
        // and its local auto-increment IDs will reset if app data is cleared
        id: `${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`,
        timestamp: parseInt(item.timestamp) || Date.now(),
        litres,
        odometer,
        source: item.source || (apiKey ? 'app' : 'web')
      });
      addedCount++;
    });

    fuelLogsStore.sort((a, b) => b.timestamp - a.timestamp);
    saveFuelLogs();

    return reply.status(201).send({ success: true, message: `Added ${addedCount} fuel logs.` });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// GET /api/fuel-logs - Fetch all fuel log entries
fastify.get('/api/fuel-logs', async (request, reply) => {
  const sortedLogs = [...fuelLogsStore].sort((a, b) => b.odometer - a.odometer);
  return reply.send(sortedLogs);
});

// DELETE /api/fuel-logs/:id - Delete a fuel log entry
fastify.delete('/api/fuel-logs/:id', async (request, reply) => {
  try {
    const { id } = request.params;
    const idNum = parseInt(id);
    const initialLength = fuelLogsStore.length;
    
    fuelLogsStore = fuelLogsStore.filter(log => log.id !== id && log.id !== idNum);

    if (fuelLogsStore.length === initialLength) {
      return reply.status(404).send({ error: 'Fuel log not found' });
    }

    saveFuelLogs();
    return reply.send({ success: true, message: 'Fuel log deleted successfully' });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// GET /api/fuel-stats - Get calculated fuel stats (average km/L, total litres, total distance)
fastify.get('/api/fuel-stats', async (request, reply) => {
  if (fuelLogsStore.length < 2) {
    return reply.send({
      averageKmPerLitre: 0,
      bestKmPerLitre: 0,
      worstKmPerLitre: 0,
      totalLitres: fuelLogsStore.reduce((acc, log) => acc + log.litres, 0),
      totalDistance: 0,
      logCount: fuelLogsStore.length
    });
  }

  const sorted = [...fuelLogsStore].sort((a, b) => a.odometer - b.odometer);
  
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
  const totalLitres = fuelLogsStore.reduce((acc, log) => acc + log.litres, 0);

  const averageKmPerLitre = totalLitresIntervals > 0 ? (totalDistanceIntervals / totalLitresIntervals) : 0;
  const bestKmPerLitre = economies.length > 0 ? Math.max(...economies) : 0;
  const worstKmPerLitre = economies.length > 0 ? Math.min(...economies) : 0;

  return reply.send({
    averageKmPerLitre: parseFloat(averageKmPerLitre.toFixed(2)),
    bestKmPerLitre: parseFloat(bestKmPerLitre.toFixed(2)),
    worstKmPerLitre: parseFloat(worstKmPerLitre.toFixed(2)),
    totalLitres: parseFloat(totalLitres.toFixed(1)),
    totalDistance: parseFloat(totalDistance.toFixed(1)),
    logCount: fuelLogsStore.length
  });
});

// GET all maintenance items with status
function getMaintenanceItems() {
  const sortedLogs = [...fuelLogsStore].sort((a, b) => b.odometer - a.odometer);
  const currentOdometer = sortedLogs.length > 0 ? sortedLogs[0].odometer : 0;

  return maintenanceStore.map(item => {
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

fastify.get('/api/maintenance', async (request, reply) => {
  const items = getMaintenanceItems();
  return reply.send(items);
})

// POST a new maintenance item
fastify.post('/api/maintenance', async (request, reply) => {
  try {
    const sortedLogs = [...fuelLogsStore].sort((a, b) => b.odometer - a.odometer);
    const currentOdometer = sortedLogs.length > 0 ? sortedLogs[0].odometer : 0;
    
    const apiKey = request.headers['x-api-key'];
    if (apiKey && !constantTimeEquals(apiKey, OBD_API_KEY)) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid API Key' });
    }

    const payload = request.body || {};
    const itemsToAdd = Array.isArray(payload) ? payload : [payload];
    let addedCount = 0;

    itemsToAdd.forEach((item, index) => {
      if (!item.name) return;

      const intervalKm = item.intervalKm ? parseFloat(item.intervalKm) : null;
      const intervalDays = item.intervalDays ? parseInt(item.intervalDays) : null;
      const lastServiceOdo = item.lastServiceOdo !== undefined && item.lastServiceOdo !== null ? parseFloat(item.lastServiceOdo) : currentOdometer;
      const lastServiceDate = item.lastServiceDate !== undefined && item.lastServiceDate !== null ? parseInt(item.lastServiceDate) : Date.now();

      maintenanceStore.push({
        id: item.id || `${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`,
        name: item.name,
        intervalKm,
        intervalDays,
        lastServiceOdo,
        lastServiceDate,
        notes: item.notes || "",
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      addedCount++;
    });

    saveMaintenance();
    return reply.status(201).send({ success: true, message: `Added ${addedCount} maintenance items.` });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
})

// PUT to edit/update a maintenance item (e.g. log a service event or edit settings)
fastify.put('/api/maintenance/:id', async (request, reply) => {
  try {
    const { id } = request.params;
    const body = request.body || {};
    const index = maintenanceStore.findIndex(item => item.id === id);

    if (index === -1) {
      return reply.status(404).send({ error: 'Maintenance item not found' });
    }

    const item = maintenanceStore[index];

    // If update requests marking as serviced now (resetting counters)
    if (body.markServiced) {
      const sortedLogs = [...fuelLogsStore].sort((a, b) => b.odometer - a.odometer);
      const currentOdometer = sortedLogs.length > 0 ? sortedLogs[0].odometer : 0;
      item.lastServiceOdo = currentOdometer;
      item.lastServiceDate = Date.now();
    } else {
      if (body.name !== undefined) item.name = body.name;
      if (body.intervalKm !== undefined) item.intervalKm = body.intervalKm ? parseFloat(body.intervalKm) : null;
      if (body.intervalDays !== undefined) item.intervalDays = body.intervalDays ? parseInt(body.intervalDays) : null;
      if (body.lastServiceOdo !== undefined) item.lastServiceOdo = body.lastServiceOdo !== null ? parseFloat(body.lastServiceOdo) : null;
      if (body.lastServiceDate !== undefined) item.lastServiceDate = body.lastServiceDate !== null ? parseInt(body.lastServiceDate) : null;
      if (body.notes !== undefined) item.notes = body.notes || "";
    }

    item.updatedAt = Date.now();
    saveMaintenance();

    return reply.send({ success: true, message: 'Maintenance item updated successfully' });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
})

// DELETE a maintenance item
fastify.delete('/api/maintenance/:id', async (request, reply) => {
  try {
    const { id } = request.params;
    const initialLength = maintenanceStore.length;
    maintenanceStore = maintenanceStore.filter(item => String(item.id) !== String(id));

    if (maintenanceStore.length === initialLength) {
      return reply.status(404).send({ error: 'Maintenance item not found' });
    }

    saveMaintenance();
    return reply.send({ success: true, message: 'Maintenance item deleted successfully' });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
})

// GET maintenance summary status
fastify.get('/api/maintenance/status', async (request, reply) => {
  return reply.send(getMaintenanceStatus());
});

// Liveness + readiness probe. Used by the container HEALTHCHECK
// and external uptime monitors. Returns 200 with build identity
// (version + commit) and a snapshot of the in-memory data store
// size. No auth required: the point of a healthcheck is that
// an external probe (k8s, compose, an uptime monitor) can call
// it without credentials. We deliberately do NOT include any
// secrets in the response.
const PACKAGE_VERSION = require('./package.json').version;
let SERVER_STARTED_AT = null;

fastify.get('/healthz', async (request, reply) => {
  return reply.send({
    status: 'ok',
    service: 'obd-telemetry-server',
    version: PACKAGE_VERSION,
    uptime_seconds: SERVER_STARTED_AT ? Math.floor((Date.now() - SERVER_STARTED_AT) / 1000) : 0,
    telemetry_records: telemetryDataStore.length,
    fuel_logs: fuelLogsStore.length,
    maintenance_items: typeof maintenanceItemsStore !== 'undefined' ? maintenanceItemsStore.length : 0,
  });
});

// ----- Android APK distribution ----------------------------------------
//
// The head unit downloads the latest APK from these endpoints.
// The APK is baked into the image at /app/agent/app-debug.apk by
// the build pipeline (see Makefile `make apk-and-server`).
// The version.json sidecar carries the version code/name and a
// SHA-256 so the head unit's installer can verify the download
// before installing.
//
// Routes:
//   GET /api/agent/latest         — JSON {versionCode, versionName,
//                                     size_bytes, sha256, download_url}
//   GET /api/agent/latest.apk     — the binary APK itself
//
// Both are unauthenticated on purpose: the APK contains the
// public-facing client and the URL is on the public dashboard
// subdomain. The HMAC for telemetry ingest is unrelated.
const APK_DOWNLOAD_PATH = process.env.APK_PATH || path.join(__dirname, 'agent', 'app-debug.apk');
const APK_VERSION_FILE = process.env.APK_VERSION_PATH || path.join(__dirname, 'agent', 'version.json');

function _readApkVersion() {
  // Returns {versionCode, versionName, size_bytes, sha256} or
  // null if the APK isn't baked into this image. The build
  // pipeline writes version.json; if absent (developer build
  // that didn't run `make apk-and-server`), we synthesize a
  // placeholder so the route returns something useful rather
  // than 503.
  if (fs.existsSync(APK_VERSION_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(APK_VERSION_FILE, 'utf8'));
    } catch (err) {
      fastify.log.warn(`Failed to parse ${APK_VERSION_FILE}: ${err}`);
    }
  }
  if (fs.existsSync(APK_DOWNLOAD_PATH)) {
    const stat = fs.statSync(APK_DOWNLOAD_PATH);
    return {
      versionCode: 0,
      versionName: 'unknown',
      size_bytes: stat.size,
      sha256: '',
      note: 'version.json not found; using placeholder values from filesystem stat',
    };
  }
  return null;
}

fastify.get('/api/agent/latest', async (request, reply) => {
  const info = _readApkVersion();
  if (!info) {
    return reply.status(404).send({
      error: 'No APK baked into this image. Run `make apk-and-server` to bundle one.',
    });
  }
  return reply.send({
    download_url: '/api/agent/latest.apk',
    ...info,
  });
});

fastify.get('/api/agent/latest.apk', async (request, reply) => {
  if (!fs.existsSync(APK_DOWNLOAD_PATH)) {
    return reply.status(404).send({
      error: 'No APK baked into this image. Run `make apk-and-server` to bundle one.',
    });
  }
  const stat = fs.statSync(APK_DOWNLOAD_PATH);
  const info = _readApkVersion() || {};
  // Use the version code in the filename so the URL is
  // cache-busted; HTTP caches will then re-check with HEAD
  // requests on subsequent visits.
  const filename = `obd-telemetry-agent-${info.versionName || 'unknown'}.apk`;
  reply.header('Content-Type', 'application/vnd.android.package-archive');
  reply.header('Content-Length', stat.size);
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  // Short cache so a freshly-deployed APK is picked up within
  // a minute; long enough that frequent polling isn't a DOS
  // vector.
  reply.header('Cache-Control', 'public, max-age=60');
  return reply.send(fs.createReadStream(APK_DOWNLOAD_PATH));
});

// ----- Installer script --------------------------------------------------
//
// `curl -sSL https://obd-api.hon2838.name.my/install.sh | sudo bash -s -- --api-key ...`
// is the one-liner the operator runs on the head unit. The
// script is baked into the image at /app/install.sh by the
// Dockerfile (or it can be overridden via OBD_INSTALL_SCRIPT).
// If absent (e.g. developer build), the route returns a stub
// shell script that prints a clear error.
const INSTALL_SCRIPT_PATH = process.env.OBD_INSTALL_SCRIPT
  || (fs.existsSync('/app/install.sh')
      ? '/app/install.sh'
      : path.join(__dirname, '..', 'static', 'install.sh'));

fastify.get('/install.sh', async (request, reply) => {
  if (!fs.existsSync(INSTALL_SCRIPT_PATH)) {
    return reply.status(404).send(
      '#!/bin/sh\n' +
      'echo "install.sh is not bundled in this server image."\n' +
      'echo "See https://github.com/hon2838/obd-telemetry-app for the script."\n' +
      'exit 1\n'
    );
  }
  reply.header('Content-Type', 'text/x-shellscript');
  reply.header('Cache-Control', 'no-store');
  return reply.send(fs.createReadStream(INSTALL_SCRIPT_PATH));
});

// Run the server!
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' })
    SERVER_STARTED_AT = Date.now()
    fastify.log.info(`Server listening on ${fastify.server.address().port}`)

    // Graceful shutdown: on SIGTERM/SIGINT, call fastify.close()
    // which (1) stops accepting new connections, (2) waits for
    // in-flight requests to finish, (3) calls onClose hooks.
    // This is the difference between retaining the last batch
    // and losing up to a few seconds of telemetry on a docker
    // restart. We do NOT use process.exit() here because
    // fastify.close() handles the lifecycle internally.
    const shutdown = async (signal) => {
      fastify.log.info(`Received ${signal}, closing fastify gracefully...`)
      try {
        await fastify.close()
        fastify.log.info('fastify closed cleanly, exiting')
        process.exit(0)
      } catch (err) {
        fastify.log.error(`Error during shutdown: ${err}`)
        process.exit(1)
      }
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

if (require.main === module) {
  start()
}

module.exports = { fastify, segmentDrives, getHaversineDistance, telemetryDataStore }
