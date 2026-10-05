// Diagnostic Trouble Code (DTC) routes plugin and dictionary

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

const DTC_PATTERN = /^[PBCU][0-3][0-9A-F]{3}$/;

function parseDtcCodes(dtcString) {
  if (typeof dtcString !== 'string' || !dtcString) return [];
  return dtcString
    .split(/[,\s]+/)
    .map(c => c.trim().toUpperCase())
    .filter(c => DTC_PATTERN.test(c));
}

function getDtcInfo(code) {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (!DTC_PATTERN.test(normalized)) return null;
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

// Legacy readers send formatted text rather than a command acknowledgment.
// Only explicit empty responses or entirely valid code lists confirm a read.
function classifyDtcRead(raw, success) {
  if (success === false) return { success: false, error: raw || 'DTC read failed', codes: [] };
  if (typeof raw !== 'string') return { success: false, error: 'Missing DTC response', codes: [] };
  const text = raw.trim();
  if (text === '' || /^(no trouble codes found|no dtcs)$/i.test(text)) {
    return { success: true, codes: [], code: 'No trouble codes found' };
  }
  const tokens = text.split(/[,\s]+/).filter(Boolean).map(code => code.toUpperCase());
  if (tokens.length > 0 && tokens.every(code => DTC_PATTERN.test(code))) {
    const codes = [...new Set(tokens)];
    return { success: true, codes, code: codes.join(', ') };
  }
  return { success: false, error: text, codes: [] };
}

function diagnosticView(diag) {
  // Completed durable commands also update latestDtc. Prefer them when newer
  // than the legacy read status, without changing the durable command protocol.
  const latestDtc = diag.latestDtc || { code: '', timestamp: null };
  const stored = diag.latestReadStatus;
  const latestReadStatus = stored && (!latestDtc.timestamp || stored.timestamp >= latestDtc.timestamp)
    ? stored
    : latestDtc.timestamp ? { ...classifyDtcRead(latestDtc.code), timestamp: latestDtc.timestamp } : { success: null, timestamp: null };
  // Older stores may contain raw failure text as latestDtc. Keep that text in
  // the failed status, rather than presenting it as a confirmed fault result.
  const confirmedDtc = latestDtc.timestamp && !classifyDtcRead(latestDtc.code).success
    ? { code: '', timestamp: null } : latestDtc;
  return { ...diag, latestDtc: confirmedDtc, latestReadStatus };
}

async function dtcRoutes(fastify, options) {
  const {
    vehicleExists,
    DEFAULT_VEHICLE_ID,
    serializeMutation,
    getDiagnosticsStore,
    setDiagnosticsStore,
    dtcHistoryStore,
    DIAG_PATH,
    DTC_HIST_PATH,
    runFileTransactionSync,
    retryablePersistenceError,
    resolveVehicleQuery,
    filterRecordsByScope,
    vehicleScope
  } = options;

  // Handler to ingest DTC reads
  const handleDtcPost = async (request, reply) => {
    const { dtc, timestamp, vehicleId, success } = request.body || {};
    if (typeof dtc !== 'string' || (success !== undefined && typeof success !== 'boolean')) {
      return reply.status(400).send({ error: 'dtc must be a string and success must be a boolean when supplied' });
    }
    if (vehicleId !== undefined && !vehicleExists(vehicleId)) {
      return reply.status(400).send({ error: `Unknown vehicleId: ${vehicleId}` });
    }
    const vid = request.auth?.type === 'device' ? request.auth.vehicleId : (vehicleId || DEFAULT_VEHICLE_ID);
    const time = timestamp || Date.now();
    const read = classifyDtcRead(dtc, success);

    return serializeMutation(async () => {
      try {
        const diagnosticsStore = getDiagnosticsStore();
        const nextDiagnostics = JSON.parse(JSON.stringify(diagnosticsStore));
        if (!nextDiagnostics.byVehicle[vid]) {
          nextDiagnostics.byVehicle[vid] = {
            latestDtc: { code: '', timestamp: null },
            latestClearStatus: { success: null, timestamp: null }
          };
        }
        if (read.success) nextDiagnostics.byVehicle[vid].latestDtc = { code: read.code, timestamp: time };
        nextDiagnostics.byVehicle[vid].latestReadStatus = { success: read.success, timestamp: time, ...(read.error ? { error: read.error } : {}) };
        const historyEntry = {
          id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          vehicleId: vid,
          timestamp: time,
          type: 'read',
          codes: read.codes,
          success: read.success,
          ...(read.error ? { error: read.error } : {})
        };
        const nextHistory = dtcHistoryStore.concat(historyEntry);
        runFileTransactionSync([[DIAG_PATH, nextDiagnostics], [DTC_HIST_PATH, nextHistory]]);
        setDiagnosticsStore(nextDiagnostics);
        dtcHistoryStore.push(historyEntry);
        return reply.send({ success: true, readSuccess: read.success });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  };
  fastify.post('/api/telemetry/dtc', handleDtcPost);
  fastify.post('/api/dtc', handleDtcPost);

  // Handler to ingest DTC clears
  const handleDtcClearPost = async (request, reply) => {
    const { success, timestamp, vehicleId } = request.body || {};
    if (vehicleId !== undefined && !vehicleExists(vehicleId)) {
      return reply.status(400).send({ error: `Unknown vehicleId: ${vehicleId}` });
    }
    const vid = request.auth?.type === 'device' ? request.auth.vehicleId : (vehicleId || DEFAULT_VEHICLE_ID);
    const time = timestamp || Date.now();
    const clearSuccess = success ?? false;

    return serializeMutation(async () => {
      try {
        const diagnosticsStore = getDiagnosticsStore();
        const nextDiagnostics = JSON.parse(JSON.stringify(diagnosticsStore));
        if (!nextDiagnostics.byVehicle[vid]) {
          nextDiagnostics.byVehicle[vid] = {
            latestDtc: { code: '', timestamp: null },
            latestClearStatus: { success: null, timestamp: null }
          };
        }
        nextDiagnostics.byVehicle[vid].latestClearStatus = { success: clearSuccess, timestamp: time };
        const historyEntry = {
          id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          vehicleId: vid,
          timestamp: time,
          type: 'clear',
          codes: [],
          success: clearSuccess
        };
        const nextHistory = dtcHistoryStore.concat(historyEntry);
        runFileTransactionSync([[DIAG_PATH, nextDiagnostics], [DTC_HIST_PATH, nextHistory]]);
        setDiagnosticsStore(nextDiagnostics);
        dtcHistoryStore.push(historyEntry);
        return reply.send({ success: true });
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
    });
  };
  fastify.post('/api/telemetry/dtc/clear', handleDtcClearPost);
  fastify.post('/api/dtc/clear', handleDtcClearPost);

  // Fetch diagnostics status. `?vehicle=` scopes to one vehicle.
  const handleDtcGet = async (request, reply) => {
    const vehicle = resolveVehicleQuery(request.query);
    if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });

    const history = filterRecordsByScope(dtcHistoryStore, request.auth, vehicle);

    let latest;
    const diagnosticsStore = getDiagnosticsStore();
    if (vehicle) {
      latest = diagnosticsStore.byVehicle[vehicle] || {
        latestDtc: { code: "", timestamp: null },
        latestClearStatus: { success: null, timestamp: null }
      };
    } else {
      const scope = vehicleScope(request.auth);
      const candidateEntries = Object.entries(diagnosticsStore.byVehicle)
        .filter(([vid]) => scope === null || scope.includes(vid))
        .map(([, diag]) => diag);

      latest = candidateEntries
        .filter(d => d.latestDtc?.timestamp || d.latestReadStatus?.timestamp || d.latestClearStatus?.timestamp)
        .sort((a, b) => (Math.max(b.latestDtc?.timestamp || 0, b.latestClearStatus?.timestamp || 0, b.latestReadStatus?.timestamp || 0))
                       - Math.max(a.latestDtc?.timestamp || 0, a.latestClearStatus?.timestamp || 0, a.latestReadStatus?.timestamp || 0))[0] || {
          latestDtc: { code: "", timestamp: null },
          latestClearStatus: { success: null, timestamp: null }
        };
    }

    return reply.send({
      latest: diagnosticView(latest),
      history
    });
  };
  fastify.get('/api/telemetry/dtc', handleDtcGet);
  fastify.get('/api/dtc', handleDtcGet);

  // Batch lookup DTC descriptions
  fastify.post('/api/dtc/lookup', async (request, reply) => {
    const { codes } = request.body || {};
    if (!Array.isArray(codes)) {
      return reply.status(400).send({ error: "Body must contain 'codes' array" });
    }
    const details = codes.map(code => getDtcInfo(code));
    if (details.some(detail => detail === null)) return reply.status(400).send({ error: 'Invalid DTC code' });
    return reply.send(details);
  });

  // Single lookup DTC description
  fastify.get('/api/dtc/lookup/:code', async (request, reply) => {
    const { code } = request.params;
    const detail = getDtcInfo(code);
    if (!detail) return reply.status(400).send({ error: 'Invalid DTC code' });
    return reply.send(detail);
  });
}

module.exports = dtcRoutes;
module.exports.parseDtcCodes = parseDtcCodes;
module.exports.getDtcInfo = getDtcInfo;

module.exports.classifyDtcRead = classifyDtcRead;
