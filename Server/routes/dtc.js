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
    const { dtc, timestamp, vehicleId } = request.body || {};
    if (vehicleId !== undefined && !vehicleExists(vehicleId)) {
      return reply.status(400).send({ error: `Unknown vehicleId: ${vehicleId}` });
    }
    const vid = request.auth?.type === 'device' ? request.auth.vehicleId : (vehicleId || DEFAULT_VEHICLE_ID);
    const time = timestamp || Date.now();
    const rawCodeStr = dtc || "No trouble codes found";

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
        nextDiagnostics.byVehicle[vid].latestDtc = { code: rawCodeStr, timestamp: time };
        const historyEntry = {
          id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          vehicleId: vid,
          timestamp: time,
          type: 'read',
          codes: parseDtcCodes(rawCodeStr),
          success: true
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
        .filter(d => (d.latestDtc && d.latestDtc.timestamp) || (d.latestClearStatus && d.latestClearStatus.timestamp))
        .sort((a, b) => (Math.max(b.latestDtc?.timestamp || 0, b.latestClearStatus?.timestamp || 0))
                       - Math.max(a.latestDtc?.timestamp || 0, a.latestClearStatus?.timestamp || 0))[0] || {
          latestDtc: { code: "", timestamp: null },
          latestClearStatus: { success: null, timestamp: null }
        };
    }

    return reply.send({
      latest,
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
    return reply.send(details);
  });

  // Single lookup DTC description
  fastify.get('/api/dtc/lookup/:code', async (request, reply) => {
    const { code } = request.params;
    return reply.send(getDtcInfo(code));
  });
}

module.exports = dtcRoutes;
module.exports.parseDtcCodes = parseDtcCodes;
module.exports.getDtcInfo = getDtcInfo;
