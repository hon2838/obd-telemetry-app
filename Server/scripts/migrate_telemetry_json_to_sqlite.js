// Migrate the JSON telemetry store into the exact SQLite schema used by the server.
const fs = require('fs');
const path = require('path');
const { initSqliteStorage, SUPPORTED_RECORD_FIELDS } = require('../sqlite_storage');

function canonicalRecords(records) {
  return JSON.stringify(records.map(record => Object.fromEntries(
    Object.keys(record).filter(key => record[key] !== null && record[key] !== undefined)
      .sort().map(key => [key, record[key]])
  )));
}

function normalizeRecords(records) {
  const usedSequences = new Set();
  let nextSequence = records.reduce((max, record) => {
    const sequence = Number(record?.ingestSeq);
    return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
  }, 0);

  const normalized = records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Record at index ${index} must be an object`);
    }
    const unsupported = Object.keys(record).filter(key => !SUPPORTED_RECORD_FIELDS.has(key));
    if (unsupported.length) {
      throw new Error(`Record at index ${index} has unsupported field(s): ${unsupported.join(', ')}`);
    }
    const timestamp = Number(record.timestamp);
    if (!Number.isFinite(timestamp)) {
      throw new Error(`Record at index ${index} has an invalid timestamp`);
    }

    let ingestSeq = Number(record.ingestSeq);
    if (!Number.isSafeInteger(ingestSeq) || ingestSeq <= 0 || usedSequences.has(ingestSeq)) {
      do { nextSequence += 1; } while (usedSequences.has(nextSequence));
      ingestSeq = nextSequence;
    }
    usedSequences.add(ingestSeq);
    return {
      ...record,
      timestamp,
      vehicleId: typeof record.vehicleId === 'string' && record.vehicleId ? record.vehicleId : 'default',
      ingestSeq,
      receivedAt: record.receivedAt ?? timestamp
    };
  });
  return normalized;
}

function migrateJsonToSqlite(jsonFilePath, sqliteDbPath) {
  if (!fs.existsSync(jsonFilePath)) {
    throw new Error(`Source JSON file not found: ${jsonFilePath}`);
  }

  const records = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
  if (!Array.isArray(records)) {
    throw new Error(`Expected JSON root to be an array, got ${typeof records}`);
  }
  const normalizedRecords = normalizeRecords(records);
  fs.mkdirSync(path.dirname(sqliteDbPath), { recursive: true });

  const targetExisted = fs.existsSync(sqliteDbPath);
  let storage;
  try {
    storage = initSqliteStorage(sqliteDbPath);
    if (storage.count() !== 0) {
      throw new Error(`Target SQLite database is not empty: ${sqliteDbPath}`);
    }

    const importResult = storage.importLegacyJson(normalizedRecords);
    if (importResult.insertedCount !== normalizedRecords.length || !storage.isLegacyImportComplete()) {
      throw new Error('Migration completion marker or inserted count check failed');
    }
    const finalDbCount = storage.count();
    if (finalDbCount !== normalizedRecords.length) {
      throw new Error(`Migration count mismatch: expected ${normalizedRecords.length}, found ${finalDbCount}`);
    }

    // Check every persisted field through the same reader the server uses.
    const loaded = storage.loadAllRecords();
    const expected = [...normalizedRecords].sort((a, b) => a.ingestSeq - b.ingestSeq);
    if (canonicalRecords(loaded) !== canonicalRecords(expected)) {
      throw new Error('Migration fidelity check failed: SQLite records differ from normalized source records');
    }
    let minTimestamp = null;
    let maxTimestamp = null;
    for (const record of normalizedRecords) {
      minTimestamp = minTimestamp === null ? record.timestamp : Math.min(minTimestamp, record.timestamp);
      maxTimestamp = maxTimestamp === null ? record.timestamp : Math.max(maxTimestamp, record.timestamp);
    }
    return {
      sourceCount: records.length,
      insertedCount: finalDbCount,
      skippedDuplicates: 0,
      finalDbCount,
      minTimestamp,
      maxTimestamp
    };
  } catch (err) {
    storage?.close();
    storage = null;
    if (!targetExisted) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.rmSync(`${sqliteDbPath}${suffix}`, { force: true }); } catch (_) {}
      }
    }
    throw err;
  } finally {
    storage?.close();
  }
}

if (require.main === module) {
  const jsonPath = process.argv[2] || path.join(__dirname, '..', 'data', 'telemetry.json');
  const sqlitePath = process.argv[3] || path.join(__dirname, '..', 'data', 'telemetry.sqlite');
  console.log(`Migrating ${jsonPath} -> ${sqlitePath}...`);
  try {
    console.log('Migration successful:', migrateJsonToSqlite(jsonPath, sqlitePath));
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

module.exports = { migrateJsonToSqlite, normalizeRecords };
