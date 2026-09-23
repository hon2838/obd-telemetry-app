// SQLite WAL storage engine for high-throughput append-only telemetry ingestion
const { DatabaseSync } = require('node:sqlite');

const SUPPORTED_RECORD_FIELDS = new Set([
  'timestamp', 'vehicleId', 'eventId', 'receivedAt', 'ingestSeq',
  'rpm', 'speed', 'coolantTemp', 'latitude', 'longitude', 'altitude', 'gpsSpeed',
  'engineLoad', 'throttlePos', 'fuelLevel', 'ambientTemp', 'voltage', 'batteryVoltage',
  'accelTime', 'alertCoolant', 'alertVoltage', 'accOn', 'headlightOn', 'volume',
  'wifiSsid', 'btConnected'
]);

function initSqliteStorage(sqlitePath) {
  const db = new DatabaseSync(sqlitePath);

  // FULL sync keeps acknowledged telemetry commits durable across host power loss.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = FULL;');
  db.exec('PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      vehicle_id TEXT NOT NULL DEFAULT 'default',
      event_id TEXT,
      rpm REAL,
      speed REAL,
      coolant_temp REAL,
      latitude REAL,
      longitude REAL,
      altitude REAL,
      gps_speed REAL,
      engine_load REAL,
      throttle_pos REAL,
      fuel_level REAL,
      ambient_temp REAL,
      voltage REAL,
      battery_voltage REAL,
      accel_time REAL,
      alert_coolant INTEGER,
      alert_voltage INTEGER,
      acc_on INTEGER,
      headlight_on INTEGER,
      volume REAL,
      wifi_ssid TEXT,
      bt_connected INTEGER,
      received_at INTEGER NOT NULL,
      ingest_seq INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_vehicle_event
      ON telemetry(vehicle_id, event_id) WHERE event_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_time
      ON telemetry(vehicle_id, timestamp);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  function ensureIngestSequences() {
    const rows = db.prepare('SELECT id, ingest_seq FROM telemetry ORDER BY id ASC').all();
    const seen = new Set();
    let nextSequence = rows.reduce((max, row) => {
      const sequence = Number(row.ingest_seq);
      return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
    }, 0);
    const repairs = [];
    for (const row of rows) {
      const sequence = Number(row.ingest_seq);
      if (Number.isSafeInteger(sequence) && sequence > 0 && !seen.has(sequence)) {
        seen.add(sequence);
      } else {
        do { nextSequence += 1; } while (seen.has(nextSequence));
        seen.add(nextSequence);
        repairs.push([nextSequence, row.id]);
      }
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const update = db.prepare('UPDATE telemetry SET ingest_seq = ? WHERE id = ?');
      for (const [sequence, id] of repairs) update.run(sequence, id);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_ingest_seq
          ON telemetry(ingest_seq);
      `);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
    return repairs.length;
  }

  // Repair legacy sequence values once, before adding the uniqueness guarantee.
  try {
    ensureIngestSequences();
  } catch (err) {
    try { db.close(); } catch (_) {}
    throw err;
  }

  const insertStmt = db.prepare(`
    INSERT INTO telemetry (
      timestamp, vehicle_id, event_id, rpm, speed, coolant_temp,
      latitude, longitude, altitude, gps_speed, engine_load,
      throttle_pos, fuel_level, ambient_temp, voltage, battery_voltage,
      accel_time, alert_coolant, alert_voltage, acc_on, headlight_on,
      volume, wifi_ssid, bt_connected, received_at, ingest_seq
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  function insertRecord(r) {
    insertStmt.run(
      r.timestamp,
      r.vehicleId || 'default',
      r.eventId || null,
      r.rpm ?? null,
      r.speed ?? null,
      r.coolantTemp ?? null,
      r.latitude ?? null,
      r.longitude ?? null,
      r.altitude ?? null,
      r.gpsSpeed ?? null,
      r.engineLoad ?? null,
      r.throttlePos ?? null,
      r.fuelLevel ?? null,
      r.ambientTemp ?? null,
      r.voltage ?? null,
      r.batteryVoltage ?? null,
      r.accelTime ?? null,
      r.alertCoolant === true ? 1 : (r.alertCoolant === false ? 0 : null),
      r.alertVoltage === true ? 1 : (r.alertVoltage === false ? 0 : null),
      r.accOn === true ? 1 : (r.accOn === false ? 0 : null),
      r.headlightOn === true ? 1 : (r.headlightOn === false ? 0 : null),
      r.volume ?? null,
      r.wifiSsid ?? null,
      r.btConnected === true ? 1 : (r.btConnected === false ? 0 : null),
      r.receivedAt ?? Date.now(),
      r.ingestSeq ?? null
    );
  }

  function rowToRecord(row) {
    const record = {
      timestamp: row.timestamp,
      vehicleId: row.vehicle_id,
      receivedAt: row.received_at
    };
    if (row.event_id) record.eventId = row.event_id;
    if (row.rpm !== null) record.rpm = row.rpm;
    if (row.speed !== null) record.speed = row.speed;
    if (row.coolant_temp !== null) record.coolantTemp = row.coolant_temp;
    if (row.latitude !== null) record.latitude = row.latitude;
    if (row.longitude !== null) record.longitude = row.longitude;
    if (row.altitude !== null) record.altitude = row.altitude;
    if (row.gps_speed !== null) record.gpsSpeed = row.gps_speed;
    if (row.engine_load !== null) record.engineLoad = row.engine_load;
    if (row.throttle_pos !== null) record.throttlePos = row.throttle_pos;
    if (row.fuel_level !== null) record.fuelLevel = row.fuel_level;
    if (row.ambient_temp !== null) record.ambientTemp = row.ambient_temp;
    if (row.voltage !== null) record.voltage = row.voltage;
    if (row.battery_voltage !== null) record.batteryVoltage = row.battery_voltage;
    if (row.accel_time !== null) record.accelTime = row.accel_time;
    if (row.alert_coolant !== null) record.alertCoolant = row.alert_coolant === 1;
    if (row.alert_voltage !== null) record.alertVoltage = row.alert_voltage === 1;
    if (row.acc_on !== null) record.accOn = row.acc_on === 1;
    if (row.headlight_on !== null) record.headlightOn = row.headlight_on === 1;
    if (row.volume !== null) record.volume = row.volume;
    if (row.wifi_ssid !== null) record.wifiSsid = row.wifi_ssid;
    if (row.bt_connected !== null) record.btConnected = row.bt_connected === 1;
    if (row.ingest_seq !== null) record.ingestSeq = row.ingest_seq;
    return record;
  }

  return {
    db,
    ensureIngestSequences,
    isLegacyImportComplete() {
      return Boolean(db.prepare("SELECT 1 FROM storage_metadata WHERE key = 'legacy_json_import_complete'").get());
    },
    markLegacyImportComplete() {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("INSERT OR IGNORE INTO storage_metadata(key, value) VALUES ('legacy_json_import_complete', '1')").run();
        db.exec('COMMIT');
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
    },
    importLegacyJson(records) {
      if (!Array.isArray(records)) throw new Error('Legacy telemetry import expects an array');
      const used = new Set();
      let nextSequence = records.reduce((max, record) => {
        const sequence = Number(record?.ingestSeq);
        return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
      }, 0);
      const normalized = records.map((record, index) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`Record at index ${index} must be an object`);
        const unsupported = Object.keys(record).filter(key => !SUPPORTED_RECORD_FIELDS.has(key));
        if (unsupported.length) throw new Error(`Record at index ${index} has unsupported field(s): ${unsupported.join(', ')}`);
        const timestamp = Number(record.timestamp);
        if (!Number.isFinite(timestamp)) throw new Error(`Record at index ${index} has an invalid timestamp`);
        let ingestSeq = Number(record.ingestSeq);
        if (!Number.isSafeInteger(ingestSeq) || ingestSeq <= 0 || used.has(ingestSeq)) {
          do { nextSequence += 1; } while (used.has(nextSequence));
          ingestSeq = nextSequence;
        }
        used.add(ingestSeq);
        return {
          ...record,
          timestamp,
          vehicleId: typeof record.vehicleId === 'string' && record.vehicleId ? record.vehicleId : 'default',
          receivedAt: record.receivedAt ?? timestamp,
          ingestSeq
        };
      });

      db.exec('BEGIN IMMEDIATE');
      try {
        const complete = db.prepare("SELECT 1 FROM storage_metadata WHERE key = 'legacy_json_import_complete'").get();
        const count = db.prepare('SELECT COUNT(*) AS count FROM telemetry').get().count;
        if (complete || count !== 0) throw new Error('Legacy JSON import requires an empty, uninitialized SQLite store');
        for (const record of normalized) insertRecord(record);
        db.prepare("INSERT INTO storage_metadata(key, value) VALUES ('legacy_json_import_complete', '1')").run();
        db.exec('COMMIT');
        return { insertedCount: normalized.length, records: normalized };
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
    },
    loadAllRecords() {
      // The server's change feed is indexed by ingest sequence. Timestamp order
      // diverges when offline telemetry is backfilled, so always restore the
      // canonical ingest order and keep legacy rows without a sequence last.
      const rows = db.prepare(`
        SELECT * FROM telemetry
        ORDER BY CASE WHEN ingest_seq IS NULL THEN 1 ELSE 0 END, ingest_seq ASC, id ASC
      `).all();
      return rows.map(rowToRecord);
    },
    appendBatch(records) {
      if (!records || records.length === 0) return 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const r of records) insertRecord(r);
        db.exec('COMMIT');
        return records.length;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    appendBatchIdempotent(records) {
      if (!records || records.length === 0) return 0;
      const existingStmt = db.prepare('SELECT * FROM telemetry WHERE ingest_seq = ?');
      const recordFields = [
        ['rpm', 'rpm'], ['speed', 'speed'], ['coolantTemp', 'coolant_temp'],
        ['latitude', 'latitude'], ['longitude', 'longitude'], ['altitude', 'altitude'],
        ['gpsSpeed', 'gps_speed'], ['engineLoad', 'engine_load'], ['throttlePos', 'throttle_pos'],
        ['fuelLevel', 'fuel_level'], ['ambientTemp', 'ambient_temp'], ['voltage', 'voltage'],
        ['batteryVoltage', 'battery_voltage'], ['accelTime', 'accel_time'],
        ['alertCoolant', 'alert_coolant'], ['alertVoltage', 'alert_voltage'],
        ['accOn', 'acc_on'], ['headlightOn', 'headlight_on'], ['volume', 'volume'],
        ['wifiSsid', 'wifi_ssid'], ['btConnected', 'bt_connected']
      ];
      function sameRecord(existing, input) {
        if (existing.timestamp !== input.timestamp || existing.vehicle_id !== (input.vehicleId || 'default') ||
            existing.event_id !== (input.eventId || null) || Number(existing.ingest_seq) !== input.ingestSeq) return false;
        for (const [key, column] of recordFields) {
          let value = input[key] ?? null;
          if (['alert_coolant', 'alert_voltage', 'acc_on', 'headlight_on', 'bt_connected'].includes(column)) {
            value = value === true ? 1 : (value === false ? 0 : null);
          }
          const actual = existing[column];
          if (actual !== value) return false;
        }
        if (Object.prototype.hasOwnProperty.call(input, 'receivedAt') && existing.received_at !== input.receivedAt) return false;
        return true;
      }
      const seenInBatch = new Map();
      const toInsert = [];
      for (const record of records) {
        if (!Number.isSafeInteger(record.ingestSeq) || record.ingestSeq <= 0) {
          throw new Error('appendBatchIdempotent requires a positive integer ingestSeq for every record');
        }
        const identity = record;
        const prior = seenInBatch.get(record.ingestSeq);
        if (prior) {
          if (JSON.stringify(prior) !== JSON.stringify(identity)) {
            throw new Error(`Conflicting records share ingestSeq ${record.ingestSeq}`);
          }
          continue;
        }
        seenInBatch.set(record.ingestSeq, identity);
        const existing = existingStmt.get(record.ingestSeq);
        if (existing) {
          if (!sameRecord(existing, identity)) {
            throw new Error(`ingestSeq ${record.ingestSeq} already belongs to a different telemetry record`);
          }
          continue;
        }
        toInsert.push(record);
      }
      return this.appendBatch(toInsert);
    },
    hasReassignConflict(oldVehicleId, newVehicleId) {
      const row = db.prepare(`
        SELECT 1 AS conflict
        FROM telemetry moving
        JOIN telemetry target
          ON target.vehicle_id = ?
         AND target.event_id = moving.event_id
        WHERE moving.vehicle_id = ?
          AND moving.event_id IS NOT NULL
        LIMIT 1
      `).get(newVehicleId, oldVehicleId);
      return Boolean(row);
    },
    applyJournalOperation(txnId, operation) {
      if (typeof txnId !== 'string' || !txnId) throw new Error('txnId must be a non-empty string');
      if (!operation || !['append', 'reassignVehicle'].includes(operation.type)) {
        throw new Error('Unsupported SQLite journal operation');
      }
      db.exec(`CREATE TABLE IF NOT EXISTS txn_applied (txn_id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
      db.exec('PRAGMA synchronous = FULL');
      try {
        db.exec('BEGIN IMMEDIATE');
        if (db.prepare('SELECT 1 FROM txn_applied WHERE txn_id = ?').get(txnId)) {
          db.exec('COMMIT');
          db.exec('PRAGMA synchronous = FULL');
          return { applied: false };
        }
        if (operation.type === 'append') {
          if (!Array.isArray(operation.records)) throw new Error('append operation requires a records array');
          for (const record of operation.records) insertRecord(record);
        } else {
          if (this.hasReassignConflict(operation.oldVehicleId, operation.newVehicleId)) {
            throw new Error('Vehicle reassignment conflicts with an event already assigned to the target vehicle');
          }
          db.prepare('UPDATE telemetry SET vehicle_id = ? WHERE vehicle_id = ?').run(
            operation.newVehicleId, operation.oldVehicleId
          );
        }
        db.prepare('INSERT INTO txn_applied (txn_id, applied_at) VALUES (?, ?)').run(txnId, Date.now());
        db.exec('COMMIT');
        db.exec('PRAGMA synchronous = FULL');
        return { applied: true };
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        try { db.exec('PRAGMA synchronous = FULL'); } catch (_) {}
        throw err;
      }
    },
    reassignVehicle(oldVehicleId, newVehicleId) {
      const stmt = db.prepare('UPDATE telemetry SET vehicle_id = ? WHERE vehicle_id = ?');
      return stmt.run(newVehicleId, oldVehicleId);
    },
    count() {
      const row = db.prepare('SELECT COUNT(*) as count FROM telemetry').get();
      return row.count;
    },
    close() {
      try { db.close(); } catch (_) {}
    }
  };
}

module.exports = { initSqliteStorage, SUPPORTED_RECORD_FIELDS };
