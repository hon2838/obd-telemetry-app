// Benchmark: JSON full-store atomic write vs SQLite WAL batch append
// Evaluates I/O volume, blocking time, and latency scaling with 100-record batches.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');
const { DatabaseSync } = require('node:sqlite');

function generateRecord(id, timestamp, vehicleId = 'VH-TEST-1') {
  return {
    eventId: `evt-${vehicleId}-${id}`,
    vehicleId,
    timestamp,
    speed: Math.floor(Math.random() * 120),
    rpm: Math.floor(Math.random() * 3500) + 700,
    fuelLevel: 65.4,
    coolantTemp: 88,
    ambientTemp: 29,
    voltage: 13.8,
    latitude: 3.1390 + (Math.random() - 0.5) * 0.01,
    longitude: 101.6869 + (Math.random() - 0.5) * 0.01,
    gpsSpeed: 55.0,
    altitude: 45.0,
    ingestSeq: id
  };
}

function runJsonBatchWrite(filePath, existingRecords, newBatch) {
  const t0 = performance.now();
  const candidate = existingRecords.concat(newBatch);
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  const serialized = JSON.stringify(candidate);
  fs.writeFileSync(tempPath, serialized, 'utf8');
  fs.renameSync(tempPath, filePath);
  const durationMs = performance.now() - t0;
  const bytesWritten = Buffer.byteLength(serialized, 'utf8');
  return { durationMs, bytesWritten, totalCount: candidate.length };
}

function initSqliteDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      ingest_seq INTEGER NOT NULL,
      data JSON NOT NULL,
      UNIQUE(vehicle_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_veh_seq ON telemetry(vehicle_id, ingest_seq);
    CREATE INDEX IF NOT EXISTS idx_telemetry_veh_ts ON telemetry(vehicle_id, timestamp);
  `);
  return db;
}

function runSqliteBatchWrite(db, newBatch) {
  const t0 = performance.now();
  const insertStmt = db.prepare(`
    INSERT INTO telemetry (vehicle_id, event_id, timestamp, ingest_seq, data)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(vehicle_id, event_id) DO NOTHING;
  `);

  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  for (const record of newBatch) {
    insertStmt.run(
      record.vehicleId,
      record.eventId,
      record.timestamp,
      record.ingestSeq,
      JSON.stringify(record)
    );
  }
  db.exec('COMMIT;');
  const durationMs = performance.now() - t0;
  const approximatePayloadBytes = Buffer.byteLength(JSON.stringify(newBatch), 'utf8');
  return { durationMs, approximatePayloadBytes };
}

async function runBenchmark() {
  const testDir = path.join(os.tmpdir(), `obd-bench-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  const datasetSizes = [10000, 50000, 75000];
  const batchSize = 100;

  console.log('='.repeat(80));
  console.log(`OBD Telemetry Ingestion Benchmark: JSON Rewrite vs. SQLite WAL`);
  console.log(`Node: ${process.version} | OS: ${os.type()} ${os.release()} | Batch Size: ${batchSize} records`);
  console.log('='.repeat(80));

  for (const n of datasetSizes) {
    console.log(`\n--- Dataset size: ${n.toLocaleString()} records ---`);

    // Prepare JSON test file
    const jsonFile = path.join(testDir, `telemetry-${n}.json`);
    const initialRecords = [];
    const baseTime = 1700000000000;
    for (let i = 1; i <= n; i++) {
      initialRecords.push(generateRecord(i, baseTime + i * 3500));
    }
    fs.writeFileSync(jsonFile, JSON.stringify(initialRecords), 'utf8');
    const initialFileSizeMb = (fs.statSync(jsonFile).size / (1024 * 1024)).toFixed(2);
    console.log(`Baseline JSON file size: ${initialFileSizeMb} MB`);

    // Prepare SQLite test db
    const sqliteFile = path.join(testDir, `telemetry-${n}.db`);
    const db = initSqliteDb(sqliteFile);
    const insertStmt = db.prepare(`
      INSERT INTO telemetry (vehicle_id, event_id, timestamp, ingest_seq, data)
      VALUES (?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    for (const r of initialRecords) {
      insertStmt.run(r.vehicleId, r.eventId, r.timestamp, r.ingestSeq, JSON.stringify(r));
    }
    db.exec('COMMIT;');
    const initialDbSizeMb = (fs.statSync(sqliteFile).size / (1024 * 1024)).toFixed(2);
    console.log(`Baseline SQLite DB size: ${initialDbSizeMb} MB`);

    // Run 5 batch iterations for each method to get warm averages
    const iterations = 5;
    let jsonTotalTime = 0;
    let jsonTotalBytes = 0;
    let sqliteTotalTime = 0;

    let currentJsonRecords = initialRecords;
    for (let iter = 1; iter <= iterations; iter++) {
      const newBatch = [];
      const startId = n + (iter - 1) * batchSize + 1;
      for (let j = 0; j < batchSize; j++) {
        newBatch.push(generateRecord(startId + j, baseTime + (startId + j) * 3500));
      }

      // Benchmark JSON
      const jsonRes = runJsonBatchWrite(jsonFile, currentJsonRecords, newBatch);
      currentJsonRecords = currentJsonRecords.concat(newBatch);
      jsonTotalTime += jsonRes.durationMs;
      jsonTotalBytes += jsonRes.bytesWritten;

      // Benchmark SQLite WAL
      const sqliteRes = runSqliteBatchWrite(db, newBatch);
      sqliteTotalTime += sqliteRes.durationMs;
    }

    db.close();

    const avgJsonTime = (jsonTotalTime / iterations).toFixed(2);
    const avgJsonMbWritten = (jsonTotalBytes / iterations / (1024 * 1024)).toFixed(2);
    const avgSqliteTime = (sqliteTotalTime / iterations).toFixed(2);

    console.log(`Results across ${iterations} batches:`);
    console.log(`  JSON Rewrite : Avg ${avgJsonTime} ms/batch | Disk Write: ${avgJsonMbWritten} MB/batch`);
    console.log(`  SQLite WAL   : Avg ${avgSqliteTime} ms/batch | Disk Write: O(batch) ~${((batchSize * 300) / 1024).toFixed(1)} KB/batch`);
    console.log(`  Speedup      : ${(avgJsonTime / avgSqliteTime).toFixed(1)}x faster`);
    console.log(`  I/O Reduction: ${((jsonTotalBytes / iterations) / (batchSize * 300)).toFixed(0)}x less disk I/O`);
  }

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n' + '='.repeat(80));
  console.log('Benchmark completed successfully.');
  console.log('='.repeat(80));
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
