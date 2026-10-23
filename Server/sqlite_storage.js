// SQLite WAL storage engine for high-throughput append-only telemetry ingestion
const { DatabaseSync } = require('node:sqlite');

const SUPPORTED_RECORD_FIELDS = new Set([
  'timestamp', 'vehicleId', 'eventId', 'receivedAt', 'ingestSeq',
  'rpm', 'speed', 'coolantTemp', 'latitude', 'longitude', 'altitude', 'gpsSpeed',
  'engineLoad', 'throttlePos', 'fuelLevel', 'ambientTemp', 'voltage', 'batteryVoltage',
  'accelTime', 'alertCoolant', 'alertVoltage', 'accOn', 'headlightOn', 'volume',
  'wifiSsid', 'btConnected',
  'mafGps', 'fuelSystemStatus', 'estimatedFuelRateLph', 'estimatedFuelEconomyKmL',
  'iat', 'map'
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
      ingest_seq INTEGER,
      maf_gps REAL,
      fuel_system_status INTEGER,
      estimated_fuel_rate_lph REAL,
      estimated_fuel_economy_kml REAL,
      iat REAL,
      map REAL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_vehicle_event
      ON telemetry(vehicle_id, event_id) WHERE event_id IS NOT NULL;

    DROP INDEX IF EXISTS idx_telemetry_vehicle_time;

    CREATE INDEX IF NOT EXISTS idx_telemetry_time_seq
      ON telemetry(timestamp, ingest_seq);

    CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_time_seq
      ON telemetry(vehicle_id, timestamp, ingest_seq);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Upgrade existing WAL databases in place; older telemetry stays nullable.
  const extendedColumns = {
    maf_gps: 'REAL', fuel_system_status: 'INTEGER',
    estimated_fuel_rate_lph: 'REAL', estimated_fuel_economy_kml: 'REAL',
    iat: 'REAL', map: 'REAL'
  };
  const existingColumns = new Set(db.prepare('PRAGMA table_info(telemetry)').all().map(row => row.name));
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, type] of Object.entries(extendedColumns)) {
      if (!existingColumns.has(name)) db.exec(`ALTER TABLE telemetry ADD COLUMN ${name} ${type}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    db.close();
    throw error;
  }

  function ensureIngestSequences() {
    const hasIndex = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_telemetry_ingest_seq'").get());
    if (hasIndex) {
      const needsRepair = Boolean(db.prepare('SELECT 1 FROM telemetry WHERE ingest_seq IS NULL OR ingest_seq <= 0 LIMIT 1').get());
      if (!needsRepair) return 0;
    }
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
      volume, wifi_ssid, bt_connected, received_at, ingest_seq,
      maf_gps, fuel_system_status, estimated_fuel_rate_lph, estimated_fuel_economy_kml,
      iat, map
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
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
      r.ingestSeq ?? null,
      r.mafGps ?? null,
      r.fuelSystemStatus ?? null,
      r.estimatedFuelRateLph ?? null,
      r.estimatedFuelEconomyKmL ?? null,
      r.iat ?? null,
      r.map ?? null
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
    if (row.maf_gps !== null) record.mafGps = row.maf_gps;
    if (row.fuel_system_status !== null) record.fuelSystemStatus = row.fuel_system_status;
    if (row.estimated_fuel_rate_lph !== null) record.estimatedFuelRateLph = row.estimated_fuel_rate_lph;
    if (row.estimated_fuel_economy_kml !== null) record.estimatedFuelEconomyKmL = row.estimated_fuel_economy_kml;
    if (row.iat !== null) record.iat = row.iat;
    if (row.map !== null) record.map = row.map;
    return record;
  }

  function rowToSegmentationRecord(row) {
    const record = {
      timestamp: row.timestamp,
      vehicleId: row.vehicle_id
    };
    if (row.event_id) record.eventId = row.event_id;
    if (row.ingest_seq !== null) record.ingestSeq = row.ingest_seq;
    if (row.rpm !== null) record.rpm = row.rpm;
    if (row.speed !== null) record.speed = row.speed;
    if (row.gps_speed !== null) record.gpsSpeed = row.gps_speed;
    if (row.latitude !== null) record.latitude = row.latitude;
    if (row.longitude !== null) record.longitude = row.longitude;
    if (row.fuel_level !== null) record.fuelLevel = row.fuel_level;
    if (row.fuel_system_status !== null) record.fuelSystemStatus = row.fuel_system_status;
    if (row.estimated_fuel_rate_lph !== null) record.estimatedFuelRateLph = row.estimated_fuel_rate_lph;
    return record;
  }

  function buildScopeClause(requestedVehicleId, authorizedScope) {
    if (requestedVehicleId) {
      if (authorizedScope !== null && !authorizedScope.includes(requestedVehicleId)) {
        return { where: '1 = 0', params: [] };
      }
      return { where: 'vehicle_id = ?', params: [requestedVehicleId] };
    }
    if (authorizedScope === null) {
      return { where: '1 = 1', params: [] };
    }
    if (authorizedScope.length === 0) {
      return { where: '1 = 0', params: [] };
    }
    return {
      where: 'vehicle_id IN (' + authorizedScope.map(() => '?').join(',') + ')',
      params: authorizedScope.slice()
    };
  }

  return {
    db,
    rowToRecord,
    rowToSegmentationRecord,
    buildScopeClause,
    ensureIngestSequences,
    getMaxIngestSeq() {
      const row = db.prepare('SELECT MAX(ingest_seq) as maxSeq FROM telemetry').get();
      return Number(row?.maxSeq) || 0;
    },
    getVehicleCounts() {
      const rows = db.prepare('SELECT vehicle_id, COUNT(*) as count FROM telemetry GROUP BY vehicle_id').all();
      const counts = new Map();
      for (const row of rows) {
        counts.set(row.vehicle_id, Number(row.count) || 0);
      }
      return counts;
    },
    getLatest(requestedVehicleId = null, authorizedScope = null) {
      const scope = buildScopeClause(requestedVehicleId, authorizedScope);
      const sql = `
        SELECT * FROM telemetry
        WHERE ${scope.where}
        ORDER BY timestamp DESC, ingest_seq DESC
        LIMIT 1
      `;
      const row = db.prepare(sql).get(...scope.params);
      return row ? rowToRecord(row) : null;
    },
    getSnapshotTail(limit, cursor = null, requestedVehicleId = null, authorizedScope = null) {
      const scope = buildScopeClause(requestedVehicleId, authorizedScope);
      const cursorClause = cursor !== null && cursor !== undefined ? 'AND ingest_seq <= ?' : '';
      const params = [...scope.params];
      if (cursorClause) params.push(cursor);
      params.push(limit);

      const sql = `
        SELECT * FROM (
          SELECT * FROM telemetry
          WHERE ${scope.where} ${cursorClause}
          ORDER BY timestamp DESC, ingest_seq DESC
          LIMIT ?
        ) ORDER BY timestamp ASC, ingest_seq ASC
      `;
      const rows = db.prepare(sql).all(...params);
      return rows.map(rowToRecord);
    },
    getChanges(cursor, limit, requestedVehicleId = null, authorizedScope = null) {
      const scope = buildScopeClause(requestedVehicleId, authorizedScope);
      const whereClause = scope.where === '1 = 1'
        ? 'WHERE ingest_seq > ?'
        : `WHERE ingest_seq > ? AND (${scope.where})`;
      const stmt = db.prepare(`SELECT * FROM telemetry ${whereClause} ORDER BY ingest_seq ASC`);
      const iter = stmt.iterate(cursor, ...scope.params);
      const records = [];
      let nextCursor = cursor;
      let inspected = 0;
      let hasMore = false;

      try {
        while (true) {
          const step = iter.next();
          if (step.done) break;
          const row = step.value;
          inspected++;
          nextCursor = Number(row.ingest_seq);
          records.push(rowToRecord(row));
          if (records.length >= limit) {
            const peek = iter.next();
            if (!peek.done) {
              hasMore = true;
            } else {
              hasMore = Boolean(db.prepare('SELECT 1 FROM telemetry WHERE ingest_seq > ? LIMIT 1').get(nextCursor));
            }
            break;
          }
        }
        if (records.length < limit) {
          hasMore = false;
          const maxRow = db.prepare('SELECT MAX(ingest_seq) as maxSeq FROM telemetry WHERE ingest_seq > ?').get(cursor);
          if (maxRow && maxRow.maxSeq !== null && Number(maxRow.maxSeq) > nextCursor) {
            nextCursor = Number(maxRow.maxSeq);
          }
        }
      } finally {
        if (typeof iter.return === 'function') iter.return();
      }

      return { records, nextCursor, hasMore, inspected };
    },
    getSeries(start, end, requestedVehicleId = null, authorizedScope = null, pointLimit = null) {
      const scope = buildScopeClause(requestedVehicleId, authorizedScope);
      if (pointLimit === null || pointLimit === undefined || !Number.isInteger(pointLimit) || pointLimit <= 0) {
        const sql = `
          SELECT * FROM telemetry
          WHERE ${scope.where} AND timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp ASC, ingest_seq ASC
        `;
        const rows = db.prepare(sql).all(...scope.params, start, end);
        return rows.map(rowToRecord);
      }

      // Bounded streaming downsampling matching downsampleTelemetrySeries bit-for-bit
      const rawSpeedValue = row => row.speed !== null && row.speed !== undefined ? (Number(row.speed) || 0) : (Number(row.gps_speed) || 0);
      const rawRpmValue = row => Number(row.rpm) || 0;

      // Pass 1 (lightweight scalar scan):
      const scalarSql = `
        SELECT speed, gps_speed, rpm FROM telemetry
        WHERE ${scope.where} AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC, ingest_seq ASC
      `;
      const scalarIter = db.prepare(scalarSql).iterate(...scope.params, start, end);
      let N = 0;
      let minSpeedIdx = 0, minSpeedVal = 0;
      let maxSpeedIdx = 0, maxSpeedVal = 0;
      let minRpmIdx = 0, minRpmVal = 0;
      let maxRpmIdx = 0, maxRpmVal = 0;

      try {
        for (const row of scalarIter) {
          const sp = rawSpeedValue(row);
          const rpm = rawRpmValue(row);
          if (N === 0) {
            minSpeedIdx = 0; minSpeedVal = sp;
            maxSpeedIdx = 0; maxSpeedVal = sp;
            minRpmIdx = 0; minRpmVal = rpm;
            maxRpmIdx = 0; maxRpmVal = rpm;
          } else {
            if (sp < minSpeedVal) { minSpeedVal = sp; minSpeedIdx = N; }
            if (sp > maxSpeedVal) { maxSpeedVal = sp; maxSpeedIdx = N; }
            if (rpm < minRpmVal) { minRpmVal = rpm; minRpmIdx = N; }
            if (rpm > maxRpmVal) { maxRpmVal = rpm; maxRpmIdx = N; }
          }
          N++;
        }
      } finally {
        if (typeof scalarIter.return === 'function') scalarIter.return();
      }

      if (N === 0) return [];

      // Pass 2:
      if (N <= pointLimit) {
        const fullSql = `
          SELECT * FROM telemetry
          WHERE ${scope.where} AND timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp ASC, ingest_seq ASC
        `;
        const fullIter = db.prepare(fullSql).iterate(...scope.params, start, end);
        const records = [];
        try {
          for (const row of fullIter) {
            records.push(rowToRecord(row));
          }
        } finally {
          if (typeof fullIter.return === 'function') fullIter.return();
        }
        return records;
      }

      if (pointLimit === 1) {
        const sql = `
          SELECT * FROM telemetry
          WHERE ${scope.where} AND timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp ASC, ingest_seq ASC
          LIMIT 1
        `;
        const row = db.prepare(sql).get(...scope.params, start, end);
        return row ? [rowToRecord(row)] : [];
      }

      if (pointLimit === 2) {
        const firstSql = `
          SELECT * FROM telemetry
          WHERE ${scope.where} AND timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp ASC, ingest_seq ASC
          LIMIT 1
        `;
        const lastSql = `
          SELECT * FROM telemetry
          WHERE ${scope.where} AND timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp DESC, ingest_seq DESC
          LIMIT 1
        `;
        const firstRow = db.prepare(firstSql).get(...scope.params, start, end);
        const lastRow = db.prepare(lastSql).get(...scope.params, start, end);
        const records = [];
        if (firstRow) records.push(rowToRecord(firstRow));
        if (lastRow && (!firstRow || lastRow.id !== firstRow.id)) records.push(rowToRecord(lastRow));
        return records;
      }

      const mandatory = new Set([0, N - 1, minSpeedIdx, maxSpeedIdx, minRpmIdx, maxRpmIdx]);
      const retainedByIndex = new Map();
      const candidates = new Set();
      const selected = Array.from(mandatory);

      const fullSql = `
        SELECT * FROM telemetry
        WHERE ${scope.where} AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC, ingest_seq ASC
      `;
      const fullIter = db.prepare(fullSql).iterate(...scope.params, start, end);

      try {
        if (selected.length >= pointLimit) {
          let index = 0;
          for (const row of fullIter) {
            if (mandatory.has(index)) {
              retainedByIndex.set(index, rowToRecord(row));
            }
            index++;
          }
        } else {
          const bucketCount = Math.max(1, pointLimit - selected.length);
          let currentBucket = 0;
          let bStart = Math.floor(currentBucket * N / bucketCount);
          let bEnd = Math.max(bStart + 1, Math.floor((currentBucket + 1) * N / bucketCount));

          let bMinSpeedIdx = bStart, bMinSpeedVal = 0, bMinSpeedRow = null;
          let bMaxSpeedIdx = bStart, bMaxSpeedVal = 0, bMaxSpeedRow = null;
          let bMinRpmIdx = bStart, bMinRpmVal = 0, bMinRpmRow = null;
          let bMaxRpmIdx = bStart, bMaxRpmVal = 0, bMaxRpmRow = null;

          let index = 0;
          for (const row of fullIter) {
            if (index === bStart) {
              const sp = rawSpeedValue(row);
              const rpm = rawRpmValue(row);
              bMinSpeedIdx = index; bMinSpeedVal = sp; bMinSpeedRow = row;
              bMaxSpeedIdx = index; bMaxSpeedVal = sp; bMaxSpeedRow = row;
              bMinRpmIdx = index; bMinRpmVal = rpm; bMinRpmRow = row;
              bMaxRpmIdx = index; bMaxRpmVal = rpm; bMaxRpmRow = row;
            } else if (index < bEnd) {
              const sp = rawSpeedValue(row);
              const rpm = rawRpmValue(row);
              if (sp < bMinSpeedVal) { bMinSpeedIdx = index; bMinSpeedVal = sp; bMinSpeedRow = row; }
              if (sp > bMaxSpeedVal) { bMaxSpeedIdx = index; bMaxSpeedVal = sp; bMaxSpeedRow = row; }
              if (rpm < bMinRpmVal) { bMinRpmIdx = index; bMinRpmVal = rpm; bMinRpmRow = row; }
              if (rpm > bMaxRpmVal) { bMaxRpmIdx = index; bMaxRpmVal = rpm; bMaxRpmRow = row; }
            }

            if (mandatory.has(index)) {
              retainedByIndex.set(index, rowToRecord(row));
            }

            if (index === bEnd - 1) {
              candidates.add(bMinSpeedIdx);
              candidates.add(bMaxSpeedIdx);
              candidates.add(bMinRpmIdx);
              candidates.add(bMaxRpmIdx);

              if (!retainedByIndex.has(bMinSpeedIdx)) retainedByIndex.set(bMinSpeedIdx, rowToRecord(bMinSpeedRow));
              if (!retainedByIndex.has(bMaxSpeedIdx)) retainedByIndex.set(bMaxSpeedIdx, rowToRecord(bMaxSpeedRow));
              if (!retainedByIndex.has(bMinRpmIdx)) retainedByIndex.set(bMinRpmIdx, rowToRecord(bMinRpmRow));
              if (!retainedByIndex.has(bMaxRpmIdx)) retainedByIndex.set(bMaxRpmIdx, rowToRecord(bMaxRpmRow));

              currentBucket++;
              if (currentBucket < bucketCount) {
                bStart = Math.floor(currentBucket * N / bucketCount);
                bEnd = Math.max(bStart + 1, Math.floor((currentBucket + 1) * N / bucketCount));
              }
            }

            index++;
          }
        }
      } finally {
        if (typeof fullIter.return === 'function') fullIter.return();
      }

      const recSpeed = rec => rec.speed !== null && rec.speed !== undefined ? (Number(rec.speed) || 0) : (Number(rec.gpsSpeed) || 0);
      const recRpm = rec => Number(rec.rpm) || 0;

      if (selected.length >= pointLimit) {
        const endpointIndexes = [0, N - 1];
        const remainingIndexes = selected
          .filter(idx => !endpointIndexes.includes(idx))
          .sort((a, b) => {
            const aRec = retainedByIndex.get(a);
            const bRec = retainedByIndex.get(b);
            const aScore = Math.max(Math.abs(recSpeed(aRec)), Math.abs(recRpm(aRec)));
            const bScore = Math.max(Math.abs(recSpeed(bRec)), Math.abs(recRpm(bRec)));
            return bScore - aScore || a - b;
          });
        return endpointIndexes
          .concat(remainingIndexes.slice(0, pointLimit - endpointIndexes.length))
          .sort((a, b) => a - b)
          .map(idx => retainedByIndex.get(idx));
      }

      const remaining = pointLimit - selected.length;
      const ranked = Array.from(candidates)
        .filter(idx => !mandatory.has(idx))
        .sort((a, b) => {
          const aRec = retainedByIndex.get(a);
          const bRec = retainedByIndex.get(b);
          const aScore = Math.max(Math.abs(recSpeed(aRec)), Math.abs(recRpm(aRec)));
          const bScore = Math.max(Math.abs(recSpeed(bRec)), Math.abs(recRpm(bRec)));
          return bScore - aScore || a - b;
        });
      selected.push(...ranked.slice(0, remaining));
      return selected.sort((a, b) => a - b).map(idx => retainedByIndex.get(idx));
    },
    getHistory({ startTime = null, endTime = null, cutoff = null, cap = 50, pageOffset = 0, tailMode = true, requestedVehicleId = null, authorizedScope = null } = {}) {
      const scope = buildScopeClause(requestedVehicleId, authorizedScope);
      const conditions = [scope.where];
      const params = [...scope.params];

      if (startTime !== null && endTime !== null) {
        conditions.push('timestamp >= ? AND timestamp <= ?');
        params.push(startTime, endTime);
      }
      if (cutoff !== null) {
        conditions.push('timestamp >= ?');
        params.push(cutoff);
      }
      const whereClause = conditions.join(' AND ');

      const countRow = db.prepare(`SELECT COUNT(*) as count FROM telemetry WHERE ${whereClause}`).get(...params);
      const totalMatched = Number(countRow?.count) || 0;

      let rows = [];
      if (tailMode) {
        const tailSql = `
          SELECT * FROM (
            SELECT * FROM telemetry
            WHERE ${whereClause}
            ORDER BY ingest_seq DESC
            LIMIT ?
          ) ORDER BY ingest_seq ASC
        `;
        rows = db.prepare(tailSql).all(...params, cap);
      } else {
        const pagedSql = `
          SELECT * FROM telemetry
          WHERE ${whereClause}
          ORDER BY ingest_seq ASC
          LIMIT ? OFFSET ?
        `;
        rows = db.prepare(pagedSql).all(...params, cap, pageOffset);
      }

      return {
        records: rows.map(rowToRecord),
        totalMatched
      };
    },
    getPerformanceRuns(requestedVehicleId = null, authorizedScope = null) {
      const scope = buildScopeClause(requestedVehicleId, authorizedScope);
      const sql = `
        SELECT * FROM telemetry
        WHERE ${scope.where} AND accel_time IS NOT NULL AND accel_time > 0
        ORDER BY timestamp ASC, ingest_seq ASC
      `;
      const rows = db.prepare(sql).all(...scope.params);
      return rows.map(rowToRecord);
    },
    getTopSpeed(requestedVehicleId = null, authorizedScope = null) {
      const scope = buildScopeClause(requestedVehicleId, authorizedScope);
      const sql = `
        SELECT * FROM telemetry
        WHERE ${scope.where} AND COALESCE(speed, gps_speed, 0) > 0
        ORDER BY COALESCE(speed, gps_speed, 0) DESC, ingest_seq ASC
        LIMIT 1
      `;
      const row = db.prepare(sql).get(...scope.params);
      return row ? rowToRecord(row) : null;
    },
    getHighestRpm(requestedVehicleId = null, authorizedScope = null) {
      const scope = buildScopeClause(requestedVehicleId, authorizedScope);
      const sql = `
        SELECT * FROM telemetry
        WHERE ${scope.where} AND rpm IS NOT NULL AND rpm > 0
        ORDER BY rpm DESC, ingest_seq ASC
        LIMIT 1
      `;
      const row = db.prepare(sql).get(...scope.params);
      return row ? rowToRecord(row) : null;
    },
    getRecordsForDrive(vehicleId, startTime, endTime) {
      const sql = `
        SELECT * FROM telemetry
        WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC, ingest_seq ASC
      `;
      const rows = db.prepare(sql).all(vehicleId, startTime, endTime);
      return rows.map(rowToRecord);
    },
    *iterateRecordsForDrive(vehicleId, startTime, endTime) {
      const sql = `
        SELECT * FROM telemetry
        WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC, ingest_seq ASC
      `;
      const iterator = db.prepare(sql).iterate(vehicleId, startTime, endTime);
      try {
        for (const row of iterator) {
          yield rowToRecord(row);
        }
      } finally {
        if (typeof iterator.return === 'function') iterator.return();
      }
    },
    getRecordsForSegmentation(vehicleFilter = null) {
      let where = '1 = 1';
      let params = [];
      if (typeof vehicleFilter === 'string') {
        where = 'vehicle_id = ?';
        params = [vehicleFilter];
      } else if (Array.isArray(vehicleFilter)) {
        if (vehicleFilter.length === 0) return [];
        where = 'vehicle_id IN (' + vehicleFilter.map(() => '?').join(',') + ')';
        params = vehicleFilter.slice();
      }
      const sql = `
        SELECT * FROM telemetry
        WHERE ${where}
        ORDER BY vehicle_id ASC, timestamp ASC, ingest_seq ASC
      `;
      const rows = db.prepare(sql).all(...params);
      return rows.map(rowToRecord);
    },
    *iterateRecordsForSegmentation(vehicleFilter = null) {
      let where = '1 = 1';
      let params = [];
      if (typeof vehicleFilter === 'string') {
        where = 'vehicle_id = ?';
        params = [vehicleFilter];
      } else if (Array.isArray(vehicleFilter)) {
        if (vehicleFilter.length === 0) return;
        where = 'vehicle_id IN (' + vehicleFilter.map(() => '?').join(',') + ')';
        params = vehicleFilter.slice();
      }
      const sql = `
        SELECT timestamp, vehicle_id, event_id, ingest_seq, rpm, speed, gps_speed,
               latitude, longitude, fuel_level, fuel_system_status, estimated_fuel_rate_lph
        FROM telemetry
        WHERE ${where}
        ORDER BY vehicle_id ASC, timestamp ASC, ingest_seq ASC
      `;
      const iterator = db.prepare(sql).iterate(...params);
      try {
        for (const row of iterator) {
          yield rowToSegmentationRecord(row);
        }
      } finally {
        if (typeof iterator.return === 'function') iterator.return();
      }
    },
    classifyBatchEventIds(records) {
      const checkStmt = db.prepare('SELECT 1 FROM telemetry WHERE vehicle_id = ? AND event_id = ? LIMIT 1');
      const seen = new Set();
      const accepted = [];
      const duplicate = [];
      for (const record of records) {
        const eventId = record.eventId;
        const vid = record.vehicleId || 'default';
        if (eventId) {
          const key = `${vid}\u0000${eventId}`;
          if (seen.has(key) || checkStmt.get(vid, eventId)) {
            duplicate.push(eventId);
            continue;
          }
          seen.add(key);
        }
        accepted.push(record);
      }
      return { accepted, duplicate };
    },
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
        ['wifiSsid', 'wifi_ssid'], ['btConnected', 'bt_connected'],
        ['mafGps', 'maf_gps'], ['fuelSystemStatus', 'fuel_system_status'],
        ['estimatedFuelRateLph', 'estimated_fuel_rate_lph'],
        ['estimatedFuelEconomyKmL', 'estimated_fuel_economy_kml'],
        ['iat', 'iat'], ['map', 'map']
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
