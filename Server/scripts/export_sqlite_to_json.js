// Export telemetry.sqlite using the same reader and schema as the running server.
const fs = require('fs');
const path = require('path');
const { initSqliteStorage } = require('../sqlite_storage');

function exportSqliteToJson(sqliteDbPath, jsonOutputPath) {
  if (!fs.existsSync(sqliteDbPath)) {
    throw new Error(`SQLite database not found: ${sqliteDbPath}`);
  }

  const storage = initSqliteStorage(sqliteDbPath);
  let records;
  try {
    const expectedCount = storage.count();
    records = storage.loadAllRecords();
    if (records.length !== expectedCount) {
      throw new Error(`Export count mismatch: expected ${expectedCount}, read ${records.length}`);
    }
  } finally {
    storage.close();
  }

  fs.mkdirSync(path.dirname(jsonOutputPath), { recursive: true });
  const temporaryPath = `${jsonOutputPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(records, null, 2), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, jsonOutputPath);
  } catch (err) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
    throw err;
  }

  return {
    exportedCount: records.length,
    outputPath: jsonOutputPath
  };
}

if (require.main === module) {
  const sqlitePath = process.argv[2] || path.join(__dirname, '..', 'data', 'telemetry.sqlite');
  const jsonPath = process.argv[3] || path.join(__dirname, '..', 'data', 'telemetry_exported.json');
  console.log(`Exporting ${sqlitePath} -> ${jsonPath}...`);
  try {
    console.log('Export successful:', exportSqliteToJson(sqlitePath, jsonPath));
  } catch (err) {
    console.error('Export failed:', err.message);
    process.exit(1);
  }
}

module.exports = { exportSqliteToJson };
