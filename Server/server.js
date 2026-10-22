const trustProxySetting = (() => {
  const value = process.env.OBD_TRUST_PROXY?.trim()
  if (!value || value === 'false') return false
  if (value === 'true') return true
  return value.split(',').map(entry => entry.trim()).filter(Boolean)
})()

const fastify = require('fastify')({
  logger: process.env.NODE_ENV === 'test' ? false : true,
  trustProxy: trustProxySetting
})
const cors = require('@fastify/cors')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const util = require('util')
const { Readable } = require('stream')
const { installAuthorization, canAccessVehicle, vehicleScope, isAdmin } = require('./authorization')
const healthRoutes = require('./routes/health')
const agentRoutes = require('./routes/agent')
const commandsRoutes = require('./routes/commands')
const performanceRoutes = require('./routes/performance')
const dtcRoutes = require('./routes/dtc')
const fuelRoutes = require('./routes/fuel')
const maintenanceRoutes = require('./routes/maintenance')
const vehiclesRoutes = require('./routes/vehicles')
const authRoutes = require('./routes/auth')
const exportRoutes = require('./routes/export')
const { initSqliteStorage } = require('./sqlite_storage')
const { calculateTripMetrics, knownSpeed, validGps } = require('./trip_calculations')

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

// Data directory is env-overridable so test suites can run against a
// temp dir instead of polluting real (dev/prod) store files.
const DB_DIR = process.env.OBD_DATA_DIR || path.join(__dirname, 'data')
const DB_PATH = path.join(DB_DIR, 'telemetry.json')
const SQLITE_DB_PATH = path.join(DB_DIR, 'telemetry.sqlite')
const STORAGE_ENGINE = (process.env.OBD_STORAGE_ENGINE || 'json').toLowerCase()
if (STORAGE_ENGINE !== 'json' && STORAGE_ENGINE !== 'sqlite') {
  throw new Error(`Unsupported OBD_STORAGE_ENGINE "${STORAGE_ENGINE}"; expected "json" or "sqlite"`)
}
const DIAG_PATH = path.join(DB_DIR, 'diagnostics.json')
const FUEL_PATH = path.join(DB_DIR, 'fuel_logs.json')
const DTC_HIST_PATH = path.join(DB_DIR, 'dtc_history.json')
const MAINT_PATH = path.join(DB_DIR, 'maintenance.json')
const VEHICLES_PATH = path.join(DB_DIR, 'vehicles.json')
const USERS_PATH = path.join(DB_DIR, 'users.json')
const DEVICES_PATH = path.join(DB_DIR, 'devices.json')
const INITIAL_ADMIN_SECRET_PATH = path.join(DB_DIR, '.initial_admin_secret')

// Multi-vehicle support. Every record in every store carries a
// `vehicleId`; the reserved id 'default' owns all pre-existing data so a
// server upgrade never rewrites or orphans history. Clients that don't
// send a vehicleId (older head units) ingest into 'default' unchanged.
const DEFAULT_VEHICLE_ID = 'default'
const COMMAND_TTL_MS = 24 * 60 * 60 * 1000
const VEHICLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true })
}

// ----- Durable multi-file transactions ------------------------------------
//
// Sequential candidate persists are not atomic: a crash or a failed rename
// halfway through a vehicle reassignment leaves some files moved and others
// not, and memory disagreeing with disk (verified with an injected rename
// failure: HTTP 503 while telemetry on disk had already moved). Candidate
// snapshots alone cannot fix this; every multi-file mutation below goes
// through a write-ahead journal instead:
//
//   PREPARED   journal + fully-fsynced staging files are durable before any
//              final path is touched.
//   COMMITTING journal is durably flipped before the first staging->final
//              rename, so a crash mid-commit is always recoverable.
//   recovery   runs synchronously at startup BEFORE any store is loaded:
//              PREPARED  -> delete staging, drop journal (rollback, nothing
//                           committed); COMMITTING -> rename every remaining
//                           staging file to its final path (roll forward,
//                           idempotent: a staging file that already renamed
//                           away counts as done). Any recovery failure throws
//                           during module load so the server fails closed
//                           instead of serving a half-committed data dir.
//
// All request handlers that persist funnel through serializeMutation (see
// below) and await their writes, so no unrelated persist can interleave a
// synchronous transaction. Single-file mutations keep using persist().
const TXN_JOURNAL_PATH = path.join(DB_DIR, 'txn_journal.json')

let isServerPoisoned = false
let serverPoisonError = null

function poisonServer(err) {
  isServerPoisoned = true
  serverPoisonError = err
  fastify.log.error(`FATAL: Server process poisoned: ${err?.message || err}`)
}

function _resetPoisonStateForTesting() {
  isServerPoisoned = false
  serverPoisonError = null
}

function isPoisoned() {
  return isServerPoisoned
}

fastify.addHook('onRequest', async (request, reply) => {
  if (isServerPoisoned) {
    return reply.status(503).send({
      error: 'Server process is poisoned due to a critical persistence failure; restart required',
      poisoned: true,
      retryable: false
    })
  }
})

function fsyncFileSync(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function fsyncDirSync(dirPath) {
  try {
    const fd = fs.openSync(dirPath, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    if (process.platform === 'linux') {
      throw err
    }
    // Best effort: some platforms cannot fsync a directory handle.
  }
}

async function fsyncFile(filePath) {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function fsyncDir(dirPath) {
  try {
    const handle = await fs.promises.open(dirPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (err) {
    if (process.platform === 'linux') {
      throw err
    }
    // Best effort: some platforms cannot fsync a directory handle.
  }
}

function atomicWriteSync(targetPath, data) {
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`
  let renamed = false
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fsyncFileSync(tmp)
    fs.renameSync(tmp, targetPath)
    renamed = true
    fsyncDirSync(path.dirname(targetPath))
  } catch (err) {
    if (!renamed) {
      try { fs.unlinkSync(tmp) } catch (_) {}
    } else {
      poisonServer(new Error(`Failure occurred after rename of ${targetPath}: ${err.message}`))
    }
    throw err
  }
}

function stagingPathFor(targetPath, txnId) {
  return `${targetPath}.txn.${txnId}.tmp`
}

function isTxnStagingFile(name) {
  return /\.txn\.txn_[^.]+\.tmp$/.test(name)
}

// Atomically commit a unit of file snapshots: entries is an array of
// [absoluteTargetPath, data] pairs. Either every target is replaced or
// none is; memory must only be updated after this returns. Throws the
// original error after rolling back (staging failure) or leaving a
// COMMITTING journal for startup roll-forward (commit failure).
function runFileTransactionSync(entries, sqliteOperation = null) {
  if (isServerPoisoned) {
    throw (serverPoisonError || new Error('Server is poisoned: refusing to run transaction'))
  }
  if (!Array.isArray(entries)) throw new TypeError('Transaction entries must be an array')
  if (entries.length === 0 && !sqliteOperation) return
  if (sqliteOperation && !sqliteStorage) {
    throw new Error('SQLite operation requires the SQLite storage engine')
  }
  if (fs.existsSync(TXN_JOURNAL_PATH)) {
    const err = new Error(`Cannot start transaction: unresolved journal already exists at ${TXN_JOURNAL_PATH}`)
    poisonServer(err)
    throw err
  }
  const txnId = `txn_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  const staging = entries.map(([target]) => stagingPathFor(target, txnId))
  const journal = {
    id: txnId,
    state: 'PREPARED',
    files: entries.map(([target]) => target),
    ...(sqliteOperation ? { sqliteOperation } : {}),
    createdAt: Date.now()
  }
  const cleanupStaging = () => {
    for (const tmp of staging) {
      try { fs.unlinkSync(tmp) } catch (_) {}
    }
  }
  // Phase 1: durable intent + staged snapshots; no final path touched.
  try {
    atomicWriteSync(TXN_JOURNAL_PATH, journal)
    entries.forEach(([, data], index) => atomicWriteSync(staging[index], data))
  } catch (err) {
    cleanupStaging()
    try { fs.unlinkSync(TXN_JOURNAL_PATH) } catch (_) {}
    throw err
  }
  // Phase 2: flip to COMMITTING durably, then rename each staging file.
  // Recovery rolls forward from this journal, so a crash here is safe.
  try {
    atomicWriteSync(TXN_JOURNAL_PATH, { ...journal, state: 'COMMITTING' })
  } catch (err) {
    let journalState = null
    try {
      journalState = JSON.parse(fs.readFileSync(TXN_JOURNAL_PATH, 'utf8')).state
    } catch (_) {}
    if (journalState === 'COMMITTING') {
      poisonServer(new Error(`Transaction ${txnId} entered COMMITTING state but failed: ${err.message}`))
    } else {
      cleanupStaging()
      try { fs.unlinkSync(TXN_JOURNAL_PATH) } catch (_) {}
    }
    throw err
  }

  try {
    // The SQLite operation and its durable txn marker commit together. If a
    // crash occurs before the staged files land, recovery replays this txn ID
    // without inserting or reassigning the same rows twice.
    if (sqliteOperation) sqliteStorage.applyJournalOperation(txnId, sqliteOperation)
    for (let index = 0; index < staging.length; index++) {
      fs.renameSync(staging[index], entries[index][0])
      fsyncDirSync(DB_DIR)
    }
  } catch (err) {
    poisonServer(new Error(`Transaction ${txnId} failed mid-commit: ${err.message}`))
    throw err
  }
  try {
    fs.unlinkSync(TXN_JOURNAL_PATH)
    fsyncDirSync(DB_DIR)
  } catch (err) {
    poisonServer(new Error(`Transaction ${txnId} commit cleanup failed: ${err.message}`))
    throw err
  }
}

function recoverPendingTransactionsSync() {
  // If a journal is present it owns its staging files: a PREPARED journal
  // rolls back, a COMMITTING journal rolls forward. Only afterwards are
  // leftover staging files (a crash before any journal was durable, or an
  // older version without journals) safe to sweep as true orphans.
  if (!fs.existsSync(TXN_JOURNAL_PATH)) {
    sweepTxnOrphansSync();
    return
  }
  let journal
  try {
    journal = JSON.parse(fs.readFileSync(TXN_JOURNAL_PATH, 'utf8'))
  } catch (err) {
    throw new Error(`Transaction recovery failed: corrupt journal, refusing to start: ${err.message}`)
  }
  if (!journal || typeof journal !== 'object' || typeof journal.id !== 'string' || !Array.isArray(journal.files)) {
    throw new Error('Transaction recovery failed: malformed journal, refusing to start')
  }
  try {
    if (journal.state === 'PREPARED') {
      // Nothing committed: drop staging and the journal (rollback).
      for (const target of journal.files) {
        try { fs.unlinkSync(stagingPathFor(target, journal.id)) } catch (_) {}
      }
      fs.unlinkSync(TXN_JOURNAL_PATH)
      fsyncDirSync(DB_DIR)
    } else if (journal.state === 'COMMITTING') {
      if (journal.sqliteOperation) {
        if (STORAGE_ENGINE !== 'sqlite' || !sqliteStorage) {
          throw new Error('SQLite transaction journal cannot be recovered without SQLite storage')
        }
        sqliteStorage.applyJournalOperation(journal.id, journal.sqliteOperation)
      }
      // Roll forward: every file reaches its staged content. A staging
      // file that already renamed away counts as done (idempotent).
      for (const target of journal.files) {
        const staging = stagingPathFor(target, journal.id)
        if (fs.existsSync(staging)) {
          fs.renameSync(staging, target)
        } else if (!fs.existsSync(target)) {
          throw new Error(`missing both staging and final for ${target}`)
        }
      }
      fs.unlinkSync(TXN_JOURNAL_PATH)
      fsyncDirSync(DB_DIR)
    } else {
      throw new Error(`unknown journal state: ${journal.state}`)
    }
  } catch (err) {
    throw new Error(`Transaction recovery failed, refusing to start: ${err.message}`)
  }
  sweepTxnOrphansSync()
}

function sweepTxnOrphansSync() {
  try {
    for (const name of fs.readdirSync(DB_DIR)) {
      if (isTxnStagingFile(name)) {
        try { fs.unlinkSync(path.join(DB_DIR, name)) } catch (_) {}
      }
    }
  } catch (err) {
    throw new Error(`Transaction recovery failed: cannot scan data dir: ${err.message}`)
  }
}

// Load existing telemetry data or start fresh
let sqliteStorage = null;
let sqliteDatabaseAlreadyExisted = false
if (STORAGE_ENGINE === 'sqlite') {
  sqliteDatabaseAlreadyExisted = fs.existsSync(SQLITE_DB_PATH)
  if (!sqliteDatabaseAlreadyExisted && fs.existsSync(TXN_JOURNAL_PATH)) {
    throw new Error('SQLite database is missing while a transaction journal is pending; refusing to recreate it')
  }
  try {
    sqliteStorage = initSqliteStorage(SQLITE_DB_PATH)
    const requiredColumns = [
      'timestamp', 'vehicle_id', 'event_id', 'rpm', 'speed', 'coolant_temp',
      'latitude', 'longitude', 'altitude', 'gps_speed', 'engine_load',
      'throttle_pos', 'fuel_level', 'ambient_temp', 'voltage', 'battery_voltage',
      'accel_time', 'alert_coolant', 'alert_voltage', 'acc_on', 'headlight_on',
      'volume', 'wifi_ssid', 'bt_connected', 'received_at', 'ingest_seq'
    ]
    const existingColumns = new Set(
      sqliteStorage.db.prepare('PRAGMA table_info(telemetry)').all().map(column => column.name)
    )
    const missingColumns = requiredColumns.filter(column => !existingColumns.has(column))
    if (missingColumns.length > 0) {
      throw new Error(`telemetry table is missing required columns: ${missingColumns.join(', ')}`)
    }
    const integrityResult = sqliteStorage.db.prepare('PRAGMA quick_check').all()
    if (integrityResult.length !== 1 || integrityResult[0].quick_check !== 'ok') {
      throw new Error(`SQLite database integrity check failed: ${integrityResult.map(row => row.quick_check).join('; ')}`)
    }
    if (typeof sqliteStorage.ensureIngestSequences !== 'function') {
      throw new Error('SQLite storage does not support durable ingest sequence repair')
    }
    sqliteStorage.ensureIngestSequences()
  } catch (err) {
    sqliteStorage?.close()
    throw new Error(`SQLite storage initialization failed; refusing to start: ${err.message}`, { cause: err })
  }
}

// The selected SQLite participant must be open before a mixed transaction can
// be recovered, but no store may be read into memory until recovery finishes.
recoverPendingTransactionsSync()

let telemetryDataStore = []
if (sqliteStorage) {
  try {
    if (typeof sqliteStorage.isLegacyImportComplete !== 'function' ||
        typeof sqliteStorage.importLegacyJson !== 'function' ||
        typeof sqliteStorage.markLegacyImportComplete !== 'function') {
      throw new Error('SQLite storage does not support durable legacy import tracking')
    }
    const legacyJsonExists = fs.existsSync(DB_PATH)
    if (!sqliteStorage.isLegacyImportComplete()) {
      if (!sqliteDatabaseAlreadyExisted) {
        // The row import and marker are one SQLite transaction, so a crash
        // cannot leave a newly-created empty DB that looks like a completed
        // migration on the next boot.
        const legacy = legacyJsonExists ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) : []
        if (!Array.isArray(legacy)) {
          throw new Error('Legacy JSON telemetry store is not an array')
        }
        for (let index = 0; index < legacy.length; index++) {
          const record = legacy[index]
          if (!record || typeof record !== 'object' || !Number.isFinite(Number(record.timestamp))) {
            throw new Error(`Legacy JSON telemetry row ${index} has an invalid timestamp or record shape`)
          }
        }
        // Give legacy rows without a usable sequence a durable SQLite
        // sequence before the import is committed. Keep valid unique values.
        const assignedSequences = new Set()
        let maxSequence = 0
        for (const record of legacy) {
          if (Number.isSafeInteger(record?.ingestSeq) && record.ingestSeq > 0) {
            maxSequence = Math.max(maxSequence, record.ingestSeq)
          }
        }
        for (const record of legacy) {
          if (!Number.isSafeInteger(record?.ingestSeq) || record.ingestSeq <= 0 || assignedSequences.has(record.ingestSeq)) {
            if (!Number.isSafeInteger(maxSequence + 1)) {
              throw new Error('Cannot assign a durable ingest sequence beyond the safe integer range')
            }
            record.ingestSeq = ++maxSequence
          }
          assignedSequences.add(record.ingestSeq)
        }
        sqliteStorage.importLegacyJson(legacy)
      } else if (sqliteStorage.count() === 0 && legacyJsonExists) {
        throw new Error('SQLite is empty while legacy JSON exists and no completed-import marker is present; refusing to guess which store is authoritative')
      } else {
        // A populated existing SQLite database is authoritative after the
        // integrity and row checks above. Ignore stale JSON and record that
        // decision durably for subsequent startups.
        sqliteStorage.markLegacyImportComplete()
      }
    }
  } catch (err) {
    sqliteStorage.close()
    throw new Error(`SQLite telemetry load failed; refusing to start: ${err.message}`, { cause: err })
  }
} else if (fs.existsSync(DB_PATH)) {
  try {
    telemetryDataStore = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  } catch (err) {
    fastify.log.error('Error reading telemetry data file, backing up and starting fresh:', err)
    fs.renameSync(DB_PATH, `${DB_PATH}.bak.${Date.now()}`)
  }
}

// Load diagnostics or start fresh. The multi-vehicle layout is
// { byVehicle: { <vehicleId>: { latestDtc, latestClearStatus } } };
// a legacy flat { latestDtc, latestClearStatus } file is migrated
// into the default vehicle's slot on load.
let diagnosticsStore = { byVehicle: {} }
if (fs.existsSync(DIAG_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DIAG_PATH, 'utf8'))
    if (loaded && typeof loaded === 'object' && loaded.byVehicle) {
      diagnosticsStore = loaded
    } else if (loaded && typeof loaded === 'object') {
      diagnosticsStore = { byVehicle: { [DEFAULT_VEHICLE_ID]: loaded } }
    }
  } catch (err) {
    fastify.log.error('Error reading diagnostics file, backing up and starting fresh:', err)
    fs.renameSync(DIAG_PATH, `${DIAG_PATH}.bak.${Date.now()}`)
  }
}

// Per-vehicle diagnostics slot accessor — creates the empty slot on
// first touch so callers always get a well-formed object back.
function getDiagnosticsFor(vehicleId) {
  if (!diagnosticsStore.byVehicle[vehicleId]) {
    diagnosticsStore.byVehicle[vehicleId] = {
      latestDtc: { code: "", timestamp: null },
      latestClearStatus: { success: null, timestamp: null }
    }
  }
  return diagnosticsStore.byVehicle[vehicleId]
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

// Load vehicle registry or start fresh
let vehiclesStore = []
if (fs.existsSync(VEHICLES_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(VEHICLES_PATH, 'utf8'))
    if (Array.isArray(loaded)) vehiclesStore = loaded
  } catch (err) {
    fastify.log.error('Error reading vehicles file, backing up and starting fresh:', err)
    fs.renameSync(VEHICLES_PATH, `${VEHICLES_PATH}.bak.${Date.now()}`)
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
// Shutdown hook: never SIGKILL mid-write. Awaiting the chains on close
// guarantees every queued atomic rename lands before the process exits.
fastify.addHook('onClose', async () => {
  await Promise.allSettled([..._writeChains.values()]);
  sqliteStorage?.close()
});
function persist(targetPath, data) {
  if (isServerPoisoned) {
    return Promise.reject(serverPoisonError || new Error('Server is poisoned: refusing to persist'))
  }
  const prev = _writeChains.get(targetPath) || Promise.resolve()
  const snapshot = JSON.stringify(data, null, 2)
  // A failed write must remain visible to the caller. The snapshot is taken
  // before queuing so later in-memory mutations cannot alter this write.
  const next = prev.catch(() => {}).then(async () => {
    if (isServerPoisoned) {
      throw (serverPoisonError || new Error('Server is poisoned: refusing to persist'))
    }
    const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`
    let renamed = false
    try {
      await fs.promises.writeFile(tmp, snapshot, { mode: 0o600 })
      await fsyncFile(tmp)
      await fs.promises.rename(tmp, targetPath)
      renamed = true
      await fsyncDir(path.dirname(targetPath))
    } catch (err) {
      if (!renamed) {
        try { await fs.promises.unlink(tmp) } catch (_) {}
      } else {
        poisonServer(new Error(`Failure occurred after rename of ${targetPath}: ${err.message}`))
      }
      fastify.log.error(`Failed to persist ${targetPath}: ${err}`)
      throw err
    }
  })
  _writeChains.set(targetPath, next.catch(() => {}))
  return next
}

// All store mutations that participate in a request are serialized.  This
// protects the validate -> persist candidate -> commit sequence from racing
// another request that is using the same resource.
let mutationTail = Promise.resolve()
function serializeMutation(operation) {
  if (isServerPoisoned) {
    return Promise.reject(serverPoisonError || new Error('Server is poisoned: refusing to execute mutation'))
  }
  const run = mutationTail.then(
    () => {
      if (isServerPoisoned) {
        throw (serverPoisonError || new Error('Server is poisoned: refusing to execute mutation'))
      }
      return operation()
    },
    () => {
      if (isServerPoisoned) {
        throw (serverPoisonError || new Error('Server is poisoned: refusing to execute mutation'))
      }
      return operation()
    }
  )
  mutationTail = run.catch(() => {})
  return run
}

function retryablePersistenceError(reply, request, err) {
  request.log.error(err)
  return reply.status(503).send({
    error: 'Persistence failed; retry the request',
    retryable: true
  })
}

function persistStartupMigration(targetPath, data) {
  const backupPath = fs.existsSync(targetPath) ? `${targetPath}.bak.${Date.now()}` : null
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`

  if (backupPath) fs.copyFileSync(targetPath, backupPath)
  let renamed = false
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 })
    fsyncFileSync(tmpPath)
    fs.renameSync(tmpPath, targetPath)
    renamed = true
    fsyncDirSync(path.dirname(targetPath))
  } catch (err) {
    if (!renamed) {
      try { fs.unlinkSync(tmpPath) } catch (_) {}
    } else {
      poisonServer(new Error(`Failure occurred after rename of ${targetPath}: ${err.message}`))
    }
    throw err
  }
}

// ----- Vehicle registry helpers ------------------------------------------

const saveVehicles = () => persist(VEHICLES_PATH, vehiclesStore)

// The 'default' vehicle is created lazily on boot and always exists; it
// receives all legacy data and all ingest that arrives without a vehicleId.
function ensureDefaultVehicle() {
  if (!vehiclesStore.some(v => v.id === DEFAULT_VEHICLE_ID)) {
    vehiclesStore.push({ id: DEFAULT_VEHICLE_ID, name: 'Default Vehicle', createdAt: Date.now() })
    // Startup migrations are synchronous so a failed configuration write
    // prevents the process from serving with an unpersisted registry.
    persistStartupMigration(VEHICLES_PATH, vehiclesStore)
  }
}
ensureDefaultVehicle()

function vehicleExists(id) {
  return typeof id === 'string' && vehiclesStore.some(v => v.id === id)
}

// Stamp a record list in-memory so legacy rows (no vehicleId) read as
// belonging to the default vehicle. Nothing is rewritten to disk here —
// the field is persisted the next time the store is naturally saved, so
// a deploy can't corrupt or truncate existing files on boot.
function stampLegacyVehicleIds(records) {
  for (const r of records) {
    if (r && r.vehicleId === undefined) r.vehicleId = DEFAULT_VEHICLE_ID
  }
}
stampLegacyVehicleIds(telemetryDataStore)
stampLegacyVehicleIds(fuelLogsStore)
stampLegacyVehicleIds(maintenanceStore)
stampLegacyVehicleIds(dtcHistoryStore)

// Durable telemetry change-log sequence. Existing rows are assigned stable
// sequences in file order; new rows always receive the next server sequence.
let nextIngestSeq = 0
let telemetryMigrationNeeded = false
if (sqliteStorage) {
  nextIngestSeq = sqliteStorage.getMaxIngestSeq()
} else {
  const assignedSequences = new Set()
  for (const record of telemetryDataStore) {
    if (!Number.isInteger(record.ingestSeq) || record.ingestSeq <= 0 || assignedSequences.has(record.ingestSeq)) {
      record.ingestSeq = 0
      telemetryMigrationNeeded = true
    } else {
      assignedSequences.add(record.ingestSeq)
      nextIngestSeq = Math.max(nextIngestSeq, record.ingestSeq)
    }
  }
  for (const record of telemetryDataStore) {
    if (record.ingestSeq === 0) {
      record.ingestSeq = ++nextIngestSeq
      assignedSequences.add(record.ingestSeq)
    }
  }
  if (telemetryMigrationNeeded) {
    if (STORAGE_ENGINE === 'json') {
      // persistStartupMigration makes a backup before rewriting legacy data.
      persistStartupMigration(DB_PATH, telemetryDataStore)
    }
  }
}

function eventIdOf(record) {
  return typeof record?.eventId === 'string' && record.eventId.length > 0 ? record.eventId : null
}
function telemetryEventKey(record) {
  const eventId = eventIdOf(record)
  return eventId ? `${record.vehicleId || DEFAULT_VEHICLE_ID}\u0000${eventId}` : null
}

// Event keys are maintained incrementally so batch classification does not
// rescan the complete telemetry store. This set is updated only after a
// telemetry transaction commits; failed persistence therefore cannot poison
// the dedupe state.
const telemetryEventKeySet = new Set()
function syncTelemetryEventKeySet() {
  telemetryEventKeySet.clear()
  if (!sqliteStorage) {
    for (const record of telemetryDataStore) {
      const key = telemetryEventKey(record)
      if (key) telemetryEventKeySet.add(key)
    }
  }
}
syncTelemetryEventKeySet()

let telemetryRevision = 0
let vehicleRevision = 0
let telemetrySequenceIndexValid = sqliteStorage ? true : telemetryDataStore.every((record, index, records) => {
  const sequence = Number(record.ingestSeq)
  return Number.isSafeInteger(sequence) && sequence > 0 &&
    (index === 0 || sequence > Number(records[index - 1].ingestSeq))
})
let telemetrySequenceIndexLength = sqliteStorage ? 0 : telemetryDataStore.length
let telemetrySequenceIndexLast = sqliteStorage ? nextIngestSeq : (telemetryDataStore.length > 0
  ? Number(telemetryDataStore[telemetryDataStore.length - 1].ingestSeq)
  : 0)
let lastChangesInspectedRows = 0
const latestCaptureCache = new Map()
const tripSummaryCache = new Map()
let allDriveBoundsCache = null
function cacheKeyContainsVehicle(cacheKey, vehicleId) {
  const scope = String(cacheKey).split('|')[1]
  return scope === 'all' || scope === vehicleId || scope?.split(',').includes(vehicleId)
}
function invalidateAnalyticsCaches({ telemetry = false, vehicles = false, vehicleId = null } = {}) {
  if (vehicles) {
    vehicleRevision++
    latestCaptureCache.clear()
    tripSummaryCache.clear()
    allDriveBoundsCache = null
    return
  }
  if (!telemetry) return
  allDriveBoundsCache = null
  if (vehicleId) {
    for (const key of latestCaptureCache.keys()) {
      if (cacheKeyContainsVehicle(key, vehicleId)) latestCaptureCache.delete(key)
    }
    for (const key of tripSummaryCache.keys()) {
      if (cacheKeyContainsVehicle(key, vehicleId)) tripSummaryCache.delete(key)
    }
    return
  }
  telemetryRevision++
  latestCaptureCache.clear()
  tripSummaryCache.clear()
}

function validateEventId(record) {
  return record.eventId === undefined || (typeof record.eventId === 'string' && record.eventId.length >= 1 && record.eventId.length <= 256)
}
function replaceArrayContents(target, values) {
  if (!Array.isArray(target) || !Array.isArray(values) || target === values) return
  target.length = 0
  for (let i = 0; i < values.length; i++) {
    target.push(values[i])
  }
}
function classifyEventIds(store, records, persistentKeys = null) {
  const existing = persistentKeys || new Set()
  const seen = new Set()
  const accepted = []
  const duplicate = []
  if (!persistentKeys) {
    for (const record of store) {
      const key = telemetryEventKey(record)
      if (key) existing.add(key)
    }
  }
  for (const record of records) {
    const eventId = eventIdOf(record)
    const key = eventId && `${record.vehicleId || DEFAULT_VEHICLE_ID}\u0000${eventId}`
    if (eventId && (existing.has(key) || seen.has(key))) duplicate.push(eventId)
    else {
      accepted.push(record)
      if (eventId) seen.add(key)
    }
  }
  return { accepted, duplicate }
}

// Resolve the vehicle scope for a read request: undefined/null means
// "all vehicles" (combined view, the pre-multicar behavior the dashboard
// still relies on); a value must be a known vehicle id.
function resolveVehicleQuery(query) {
  const requested = query?.vehicle
  if (requested === undefined || requested === null || requested === '') return null
  if (!vehicleExists(requested)) return undefined // signals 400
  return requested
}

function filterByVehicle(records, vehicleId) {
  if (!vehicleId) return records
  return records.filter(r => (r.vehicleId || DEFAULT_VEHICLE_ID) === vehicleId)
}

function filterRecordsByScope(records, auth, requestedVehicleId) {
  if (requestedVehicleId) {
    return filterByVehicle(records, requestedVehicleId)
  }
  const scope = vehicleScope(auth)
  if (scope === null) return records
  return records.filter(r => scope.includes(r.vehicleId || DEFAULT_VEHICLE_ID))
}

// This predicate is intentionally allocation-free. The change feed can
// inspect a large inaccessible prefix, so using filterRecordsByScope([r], ...)
// there would create a short-lived array for every inspected record.
function recordIsVisibleToScope(record, auth, requestedVehicleId) {
  const vehicleId = record.vehicleId || DEFAULT_VEHICLE_ID
  if (requestedVehicleId) return vehicleId === requestedVehicleId
  const scope = vehicleScope(auth)
  return scope === null || scope.includes(vehicleId)
}

function firstIngestSequenceAfter(records, cursor) {
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (Number(records[middle].ingestSeq) <= cursor) low = middle + 1
    else high = middle
  }
  return low
}

function telemetryCanBinarySeek() {
  if (telemetryDataStore.length !== telemetrySequenceIndexLength) return false
  if (!telemetrySequenceIndexValid) return false
  if (telemetryDataStore.length === 0) return true
  const last = telemetryDataStore[telemetryDataStore.length - 1]
  return Number(last.ingestSeq) === telemetrySequenceIndexLast
}

function refreshTelemetrySequenceIndexForTesting() {
  telemetrySequenceIndexValid = telemetryDataStore.every((record, index, records) => {
    const sequence = Number(record.ingestSeq)
    return Number.isSafeInteger(sequence) && sequence > 0 &&
      (index === 0 || sequence > Number(records[index - 1].ingestSeq))
  })
  telemetrySequenceIndexLength = telemetryDataStore.length
  telemetrySequenceIndexLast = telemetryDataStore.length > 0
    ? Number(telemetryDataStore[telemetryDataStore.length - 1].ingestSeq)
    : 0
}

function updateTelemetrySequenceIndexAfterAppend(accepted) {
  if (!telemetrySequenceIndexValid || accepted.length === 0) return
  if (telemetryDataStore.length - accepted.length !== telemetrySequenceIndexLength) {
    telemetrySequenceIndexValid = false
    telemetrySequenceIndexLength = telemetryDataStore.length
    telemetrySequenceIndexLast = Number(telemetryDataStore[telemetryDataStore.length - 1]?.ingestSeq) || 0
    return
  }
  let expected = telemetrySequenceIndexLast + 1
  for (const record of accepted) {
    if (Number(record.ingestSeq) !== expected) {
      telemetrySequenceIndexValid = false
      telemetrySequenceIndexLength = telemetryDataStore.length
      telemetrySequenceIndexLast = Number(record.ingestSeq) || 0
      return
    }
    expected++
  }
  telemetrySequenceIndexLength = telemetryDataStore.length
  telemetrySequenceIndexLast = expected - 1
}

function chronologicalRecordCompare(a, b) {
  const timestampDifference = Number(a.timestamp) - Number(b.timestamp)
  if (timestampDifference !== 0) return timestampDifference
  return Number(a.ingestSeq || 0) - Number(b.ingestSeq || 0)
}

function selectChronologicalTail(records, pointLimit, predicate) {
  const heap = []
  const swap = (left, right) => {
    const value = heap[left]
    heap[left] = heap[right]
    heap[right] = value
  }
  const siftUp = (start) => {
    let index = start
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (chronologicalRecordCompare(heap[parent], heap[index]) <= 0) break
      swap(parent, index)
      index = parent
    }
  }
  const siftDown = (start) => {
    let index = start
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      if (left < heap.length && chronologicalRecordCompare(heap[left], heap[smallest]) < 0) smallest = left
      if (right < heap.length && chronologicalRecordCompare(heap[right], heap[smallest]) < 0) smallest = right
      if (smallest === index) break
      swap(index, smallest)
      index = smallest
    }
  }

  for (const record of records) {
    if (!predicate(record)) continue
    if (heap.length < pointLimit) {
      heap.push(record)
      siftUp(heap.length - 1)
    } else if (chronologicalRecordCompare(record, heap[0]) > 0) {
      heap[0] = record
      siftDown(0)
    }
  }
  return heap.sort(chronologicalRecordCompare)
}

function speedValue(record) {
  return Number(getRecordSpeed(record)) || 0
}

function rpmValue(record) {
  return Number(record.rpm) || 0
}

// Deterministic peak-preserving reduction for chart data. Every bucket offers
// its speed and RPM extrema, while the global extrema and endpoints are
// mandatory whenever the requested budget permits them. This is deliberately
// index-based rather than time-based so equal timestamps remain deterministic.
function downsampleTelemetrySeries(records, pointLimit) {
  if (records.length <= pointLimit) return records.slice()
  if (pointLimit <= 2) return pointLimit === 1 ? [records[0]] : [records[0], records[records.length - 1]]

  const mandatory = new Set([0, records.length - 1])
  const addExtreme = (valueOf, maximize) => {
    let selected = 0
    for (let index = 1; index < records.length; index++) {
      const selectedValue = valueOf(records[selected])
      const value = valueOf(records[index])
      if ((maximize && value > selectedValue) || (!maximize && value < selectedValue)) selected = index
    }
    mandatory.add(selected)
  }
  addExtreme(speedValue, false)
  addExtreme(speedValue, true)
  addExtreme(rpmValue, false)
  addExtreme(rpmValue, true)

  const selected = Array.from(mandatory)
  if (selected.length >= pointLimit) {
    // Endpoints are contractually mandatory. If the budget cannot also hold
    // every distinct extreme, retain the strongest distinct extremes in a
    // stable order after reserving both endpoints.
    const endpointIndexes = [0, records.length - 1]
    const remainingIndexes = selected
      .filter(index => !endpointIndexes.includes(index))
      .sort((a, b) => {
        const aScore = Math.max(Math.abs(speedValue(records[a])), Math.abs(rpmValue(records[a])))
        const bScore = Math.max(Math.abs(speedValue(records[b])), Math.abs(rpmValue(records[b])))
        return bScore - aScore || a - b
      })
    return endpointIndexes
      .concat(remainingIndexes.slice(0, pointLimit - endpointIndexes.length))
      .sort((a, b) => a - b)
      .map(index => records[index])
  }

  const candidates = new Set()
  const bucketCount = Math.max(1, pointLimit - selected.length)
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = Math.floor(bucket * records.length / bucketCount)
    const end = Math.max(start + 1, Math.floor((bucket + 1) * records.length / bucketCount))
    let minSpeed = start
    let maxSpeed = start
    let minRpm = start
    let maxRpm = start
    for (let index = start + 1; index < end; index++) {
      if (speedValue(records[index]) < speedValue(records[minSpeed])) minSpeed = index
      if (speedValue(records[index]) > speedValue(records[maxSpeed])) maxSpeed = index
      if (rpmValue(records[index]) < rpmValue(records[minRpm])) minRpm = index
      if (rpmValue(records[index]) > rpmValue(records[maxRpm])) maxRpm = index
    }
    candidates.add(minSpeed)
    candidates.add(maxSpeed)
    candidates.add(minRpm)
    candidates.add(maxRpm)
  }

  const remaining = pointLimit - selected.length
  const ranked = Array.from(candidates)
    .filter(index => !mandatory.has(index))
    .sort((a, b) => {
      const aScore = Math.max(Math.abs(speedValue(records[a])), Math.abs(rpmValue(records[a])))
      const bScore = Math.max(Math.abs(speedValue(records[b])), Math.abs(rpmValue(records[b])))
      return bScore - aScore || a - b
    })
  selected.push(...ranked.slice(0, remaining))
  return selected.sort((a, b) => a - b).map(index => records[index])
}

function parseStrictQueryInteger(raw, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return { error: `${name} must be an integer` }
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { error: `${name} is out of bounds` }
  }
  return { value }
}

// ----- User Accounts & Device Pairing System -----------------------------

let usersStore = []
if (fs.existsSync(USERS_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'))
    if (Array.isArray(loaded)) usersStore = loaded
  } catch (err) {
    fastify.log.error('Error reading users file, backing up and starting fresh:', err)
    fs.renameSync(USERS_PATH, `${USERS_PATH}.bak.${Date.now()}`)
  }
}

let devicesStore = []
if (fs.existsSync(DEVICES_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8'))
    if (Array.isArray(loaded)) devicesStore = loaded
  } catch (err) {
    fastify.log.error('Error reading devices file, backing up and starting fresh:', err)
    fs.renameSync(DEVICES_PATH, `${DEVICES_PATH}.bak.${Date.now()}`)
  }
}

const scryptAsync = util.promisify(crypto.scrypt)

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

const hashPasswordSync = hashPassword

async function hashPasswordAsync(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = await scryptAsync(password, salt, 64)
  return { salt, hash: hash.toString('hex') }
}

async function verifyPassword(password, salt, hash) {
  if (!password || !salt || !hash) return false
  try {
    const buf = await scryptAsync(password, salt, 64)
    return constantTimeEquals(buf.toString('hex'), hash)
  } catch {
    return false
  }
}

function verifyPasswordSync(password, salt, hash) {
  if (!password || !salt || !hash) return false
  try {
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex')
    return constantTimeEquals(testHash, hash)
  } catch {
    return false
  }
}

function getBootstrapAdminPassword() {
  const configuredPassword = process.env.OBD_INITIAL_ADMIN_PASSWORD
  if (configuredPassword !== undefined && configuredPassword !== '') {
    if (configuredPassword.length < 8) {
      throw new Error('OBD_INITIAL_ADMIN_PASSWORD must be at least 8 characters when set')
    }
    return configuredPassword
  }

  if (fs.existsSync(INITIAL_ADMIN_SECRET_PATH)) {
    const savedPassword = fs.readFileSync(INITIAL_ADMIN_SECRET_PATH, 'utf8').trim()
    if (savedPassword.length < 8) {
      throw new Error(`${INITIAL_ADMIN_SECRET_PATH} is invalid; expected at least 8 characters`)
    }
    fs.chmodSync(INITIAL_ADMIN_SECRET_PATH, 0o600)
    return savedPassword
  }

  const generatedPassword = crypto.randomBytes(16).toString('hex')
  fs.writeFileSync(INITIAL_ADMIN_SECRET_PATH, generatedPassword, { mode: 0o600, flag: 'wx' })
  return generatedPassword
}

function ensureDefaultAdminUser() {
  if (usersStore.length === 0) {
    const { salt, hash } = hashPasswordSync(getBootstrapAdminPassword())
    usersStore.push({
      id: 'usr-admin',
      username: 'admin',
      role: 'admin',
      passwordSalt: salt,
      passwordHash: hash,
      mustChangePassword: true,
      vehicles: [DEFAULT_VEHICLE_ID],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    persistStartupMigration(USERS_PATH, usersStore)
    return
  }

  // Backward-compatible migration for existing stores
  let mutated = false
  let rotatedKnownDefault = false
  for (const user of usersStore) {
    if (!user.role) {
      user.role = (user.username === 'admin' || user.id === 'usr-admin') ? 'admin' : 'user'
      mutated = true
    }
    if (verifyPasswordSync('admin12345', user.passwordSalt, user.passwordHash)) {
      const replacement = hashPasswordSync(getBootstrapAdminPassword())
      user.passwordSalt = replacement.salt
      user.passwordHash = replacement.hash
      user.mustChangePassword = true
      user.updatedAt = Date.now()
      rotatedKnownDefault = true
      mutated = true
    }
  }
  if (mutated) {
    persistStartupMigration(USERS_PATH, usersStore)
  }
  if (rotatedKnownDefault) {
    fastify.log.warn(`Rotated a known legacy admin password. Retrieve the temporary password from ${INITIAL_ADMIN_SECRET_PATH} or OBD_INITIAL_ADMIN_PASSWORD.`)
  }
}
ensureDefaultAdminUser()

function migrateDeviceTokensAtRest() {
  let mutated = false
  for (const device of devicesStore) {
    if (device.deviceToken && !device.tokenHash) {
      if (!mutated && fs.existsSync(DEVICES_PATH)) {
        try {
          fs.copyFileSync(DEVICES_PATH, `${DEVICES_PATH}.bak.${Date.now()}`)
        } catch (err) {
          fastify.log.warn(`Failed to back up ${DEVICES_PATH}: ${err}`)
        }
      }
      device.tokenHash = crypto.createHash('sha256').update(device.deviceToken).digest('hex')
      device.tokenPrefix = device.deviceToken.slice(0, 12)
      device.tokenSuffix = device.deviceToken.slice(-4)
      delete device.deviceToken
      mutated = true
    }
  }
  if (mutated) {
    // This is a startup migration: fail closed rather than serving with
    // credentials transformed only in memory.
    persistStartupMigration(DEVICES_PATH, devicesStore)
  }
}
migrateDeviceTokensAtRest()

const sessionsStore = new Map()
const pendingPairingsByToken = new Map()
const pendingPairingsByCode = new Map()
const SESSION_COOKIE = 'obd_session'
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

function parseCookies(header) {
  const cookies = {}
  if (typeof header !== 'string') return cookies
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    try { cookies[key] = decodeURIComponent(part.slice(index + 1).trim()) } catch (_) {}
  }
  return cookies
}
function sessionCookie(token, maxAge = 24 * 60 * 60) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}
function setSessionCookie(reply, token) {
  reply.header('Set-Cookie', sessionCookie(token))
}
function clearSessionCookie(reply) {
  reply.header('Set-Cookie', sessionCookie('', 0))
}
function publicUser(user, userVehicles) {
  const role = user.role || ((user.username === 'admin' || user.id === 'usr-admin') ? 'admin' : 'user')
  return {
    id: user.id,
    username: user.username,
    role,
    mustChangePassword: !!user.mustChangePassword,
    vehicles: userVehicles
  }
}
function newSession(fields) {
  const token = `sess_${crypto.randomBytes(32).toString('hex')}`
  const session = {
    ...fields,
    csrfToken: crypto.randomBytes(32).toString('hex'),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  }
  sessionsStore.set(token, session)
  return { token, session }
}

// Clean up expired pairings every minute
function cleanExpiredPairings() {
  const now = Date.now()
  for (const [code, session] of pendingPairingsByCode.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      pendingPairingsByCode.delete(code)
      if (session.pollToken) pendingPairingsByToken.delete(session.pollToken)
    }
  }
  for (const [token, session] of pendingPairingsByToken.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      pendingPairingsByToken.delete(token)
      if (session.code) pendingPairingsByCode.delete(session.code)
      if (session.normalizedCode) pendingPairingsByCode.delete(session.normalizedCode)
    }
  }
}
setInterval(cleanExpiredPairings, 60000).unref()

// Clean up expired sessions every minute; cap store size to 1000
function cleanExpiredSessions() {
  const now = Date.now()
  for (const [token, session] of sessionsStore.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      sessionsStore.delete(token)
    }
  }
  if (sessionsStore.size > 1000) {
    const sorted = [...sessionsStore.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
    const toRemove = sorted.slice(0, sorted.length - 1000)
    for (const [token] of toRemove) {
      sessionsStore.delete(token)
    }
  }
}
setInterval(cleanExpiredSessions, 60000).unref()

// Authenticates incoming requests asynchronously. Returns:
//   { type: 'master' }
//   { type: 'user', user }
//   { type: 'device', device, vehicleId }
//   null (unauthorized)
async function authenticateRequest(request) {
  // 1. Master API key check (X-API-Key)
  const apiKey = request.headers['x-api-key']
  if (apiKey) {
    if (constantTimeEquals(apiKey, OBD_API_KEY)) return { type: 'master', via: 'api-key' }
    return null
  }

  // 2. Device token, bearer session, or browser session cookie.
  const devTokenHeader = request.headers['x-device-token']
  const authHeader = request.headers['authorization']
  const cookies = parseCookies(request.headers.cookie)
  let token = devTokenHeader
  let viaCookie = false
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim()
  }
  if (!token && cookies[SESSION_COOKIE]) {
    token = cookies[SESSION_COOKIE]
    viaCookie = true
  }

  if (token) {
    if (devTokenHeader || token.startsWith('obd_dev_')) {
      const incomingHash = crypto.createHash('sha256').update(token).digest('hex')
      const device = devicesStore.find(d =>
        (d.tokenHash && constantTimeEquals(d.tokenHash, incomingHash)) ||
        (d.deviceToken && constantTimeEquals(d.deviceToken, token))
      )
      if (device) {
        device.lastSeenAt = Date.now()
        return { type: 'device', device, vehicleId: device.vehicleId || DEFAULT_VEHICLE_ID }
      }
      return null
    } else {
      const session = sessionsStore.get(token)
      if (session && session.expiresAt && session.expiresAt > Date.now()) {
        if (session.type === 'master') return { type: 'master', via: viaCookie ? 'cookie' : 'bearer', session }
        const user = usersStore.find(u => u.id === session.userId)
        if (user) return { type: 'user', user, via: viaCookie ? 'cookie' : 'bearer', session }
      }
      return null
    }
  }

  // 3. HTTP Basic Auth check (Authorization: Basic base64(user:pass))
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8')
      const colonIdx = decoded.indexOf(':')
      const username = colonIdx !== -1 ? decoded.substring(0, colonIdx) : 'admin'
      const password = colonIdx !== -1 ? decoded.substring(colonIdx + 1) : decoded

      if (password && constantTimeEquals(password, OBD_API_KEY)) {
        return { type: 'master' }
      }

      const user = usersStore.find(u => u.username.toLowerCase() === username.toLowerCase().trim())
      if (user && (await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
        return { type: 'user', user }
      }
      return null
    } catch (_err) {
      return null
    }
  }

  return null
}

// Load the durable command inbox. Legacy queue entries receive stable IDs
// exactly once so clients can retry delivery and acknowledgment after restart.
let pendingCommands = [];
if (fs.existsSync(COMMANDS_QUEUE_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(COMMANDS_QUEUE_PATH, 'utf8'));
    if (!Array.isArray(loaded)) throw new Error('Command queue must be a JSON array');
    {
      let migrated = false;
      const now = Date.now();
      pendingCommands = loaded.map(entry => {
        if (typeof entry !== 'string' && (!entry || typeof entry !== 'object' || Array.isArray(entry))) {
          throw new Error('Invalid command queue entry');
        }
        const command = typeof entry === 'string'
          ? { command: entry, vehicleId: DEFAULT_VEHICLE_ID }
          : { ...entry };
        if (!['read_dtc', 'clear_dtc'].includes(command.command)) throw new Error('Invalid command in command queue');
        if (typeof command.id !== 'string' || !command.id) { command.id = crypto.randomUUID(); migrated = true; }
        if (!command.vehicleId) { command.vehicleId = DEFAULT_VEHICLE_ID; migrated = true; }
        if (typeof command.vehicleId !== 'string') throw new Error('Invalid command vehicle in command queue');
        if (!command.status) { command.status = 'pending'; migrated = true; }
        if (!['pending', 'completed', 'failed', 'unknown', 'expired'].includes(command.status)) {
          throw new Error('Invalid command status in command queue');
        }
        if (!Number.isFinite(command.createdAt)) { command.createdAt = now; migrated = true; }
        if (!Number.isFinite(command.updatedAt)) { command.updatedAt = command.createdAt; migrated = true; }
        if (!Number.isFinite(command.expiresAt)) { command.expiresAt = command.createdAt + COMMAND_TTL_MS; migrated = true; }
        if (command.status === 'pending' && command.expiresAt <= now) {
          command.status = 'expired';
          command.updatedAt = now;
          command.result = { reason: 'command_expired' };
          migrated = true;
        }
        return command;
      });
      if (new Set(pendingCommands.map(command => command.id)).size !== pendingCommands.length) {
        throw new Error('Duplicate command IDs in command queue');
      }
      if (migrated) {
        const pending = pendingCommands.filter(command => command.status === 'pending');
        const completed = pendingCommands.filter(command => command.status !== 'pending')
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 100);
        pendingCommands = [...pending, ...completed];
        persistStartupMigration(COMMANDS_QUEUE_PATH, pendingCommands);
      }
      if (pendingCommands.length > 0) {
        fastify.log.info(`Restored ${pendingCommands.filter(c => c.status === 'pending').length} pending command(s) from disk`);
      }
    }
  } catch (err) {
    fastify.log.error(`Failed to load ${COMMANDS_QUEUE_PATH}: ${err}`);
    throw err;
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


// === Module Helpers & Business Logic ===
const { parseDtcCodes, getDtcInfo } = dtcRoutes;

function getRecordSpeed(record) {
  return record.speed !== null && record.speed !== undefined
    ? record.speed
    : (record.gpsSpeed || 0);
}


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
// Split one chronologically-sorted record list into raw drive
// segments using a 5-minute inactivity gap. Returns segments
// without id/summary — segmentDrives() owns identity assignment.
function segmentRecordsByGap(sorted) {
  const drives = [];
  let currentDrive = null;
  const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes inactivity starts a new drive

  for (const record of sorted) {
    const recordFuel = (record.fuelLevel !== null && record.fuelLevel !== undefined) ? record.fuelLevel : null;
    const recordRpm = record.rpm || 0;
    const recordSpeed = getRecordSpeed(record);

    if (!currentDrive) {
      currentDrive = {
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

  return drives;
}

function segmentDrives(vehicleFilter = null) {
  let source;
  if (sqliteStorage) {
    source = sqliteStorage.getRecordsForSegmentation(vehicleFilter);
  } else if (Array.isArray(vehicleFilter)) {
    source = telemetryDataStore.filter(r => vehicleFilter.includes(r.vehicleId || DEFAULT_VEHICLE_ID));
  } else if (typeof vehicleFilter === 'string') {
    source = filterByVehicle(telemetryDataStore, vehicleFilter);
  } else {
    source = telemetryDataStore;
  }
  if (source.length === 0) {
    return [];
  }

  // Group by vehicle BEFORE the gap segmentation so two cars
  // reporting over the same time window never merge into one drive.
  const byVehicle = new Map();
  for (const record of source) {
    const vid = record.vehicleId || DEFAULT_VEHICLE_ID;
    if (!byVehicle.has(vid)) byVehicle.set(vid, []);
    byVehicle.get(vid).push(record);
  }

  const drives = [];
  for (const [vid, records] of byVehicle) {
    const sorted = records.filter(record => typeof record.timestamp === 'number' && Number.isFinite(record.timestamp) && record.timestamp >= 0)
      .sort((a, b) => a.timestamp - b.timestamp);
    segmentRecordsByGap(sorted).forEach((seg, i) => {
      drives.push({ ...seg, id: `${vid}-${i + 1}`, vehicleId: vid });
    });
  }
  drives.sort((a, b) => a.startTime - b.startTime);

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
          const s1 = knownSpeed(p1), s2 = knownSpeed(p2);
          const accel = s1 !== null && s2 !== null ? (s2 - s1) / dt : 0; // km/h per second

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

    const tripMetrics = calculateTripMetrics(drive.points);
    // Preserve the legacy tank-based field's original GPS-only denominator.
    // New interval-based metrics use bounded GPS with an OBD-speed fallback.
    let legacyDistanceKm = 0;
    let prevPoint = null;
    for (const p of drive.points) {
      if (p.latitude && p.longitude && p.latitude !== 0 && p.longitude !== 0) {
        if (prevPoint) legacyDistanceKm += getHaversineDistance(prevPoint.latitude, prevPoint.longitude, p.latitude, p.longitude);
        prevPoint = p;
      }
    }
    const validGpsPoints = drive.points.filter(validGps);
    const startLocation = validGpsPoints.length > 0 ? { lat: validGpsPoints[0].latitude, lon: validGpsPoints[0].longitude } : null;
    const lastGpsPoint = validGpsPoints.at(-1);
    const endLocation = lastGpsPoint ? { lat: lastGpsPoint.latitude, lon: lastGpsPoint.longitude } : null;

    // 4. Fuel used and fuel efficiency. Tank size is a per-vehicle
    // property (set on the vehicle in the registry); cars without one
    // fall back to the original default so existing stats don't shift.
    let fuelUsedPercent = 0;
    if (drive.startLevel !== null && drive.endLevel !== null) {
      fuelUsedPercent = Math.max(0, drive.startLevel - drive.endLevel);
    }
    const vehicle = vehiclesStore.find(v => v.id === drive.vehicleId);
    const tankLitres = (vehicle && Number(vehicle.tankLitres) > 0) ? Number(vehicle.tankLitres) : 36;
    const fuelUsedLitres = (fuelUsedPercent / 100) * tankLitres;
    const fuelEfficiencyKmL = (fuelUsedLitres > 0 && legacyDistanceKm > 0) ? (legacyDistanceKm / fuelUsedLitres) : null;

    return {
      id: drive.id,
      vehicleId: drive.vehicleId,
      startTime: drive.startTime,
      endTime: drive.endTime,
      label: `Drive #${drive.id} - ${startStr} (${durationMin} min, ${drive.recordCount} pts)`,
      summary: {
        durationMin,
        maxRpm: drive.maxRpm,
        maxSpeed: drive.maxSpeed,
        fuelUsedPercent: parseFloat(fuelUsedPercent.toFixed(1)),
        pointCount: drive.recordCount,
        ...tripMetrics,
        startLocation,
        endLocation,
        fuelEfficiencyKmL: fuelEfficiencyKmL ? parseFloat(fuelEfficiencyKmL.toFixed(2)) : null,
        fuelEfficiencySource: 'legacy-tank-level-drop',
        legacyTankEstimate: {
          fuelUsedLitres: drive.startLevel !== null && drive.endLevel !== null ? parseFloat(fuelUsedLitres.toFixed(3)) : null,
          fuelEfficiencyKmL: fuelEfficiencyKmL ? parseFloat(fuelEfficiencyKmL.toFixed(2)) : null,
          tankLitres,
          tankCapacitySource: vehicle && Number(vehicle.tankLitres) > 0 ? 'vehicle-configured' : 'legacy-default-36-litres',
          distanceMethod: 'legacy-unbounded-gps-polyline',
          method: 'positive-endpoint-tank-level-drop-times-capacity',
          reliability: 'unvalidated-not-used-for-leaderboard'
        },
        driverScore: finalScore,
        harshEvents: { accel: harshAccelCount, brake: harshBrakeCount }
      }
    };
  });
}

function authCacheScope(auth) {
  if (!auth) return 'anonymous'
  if (isAdmin(auth)) return 'admin'
  if (auth.type === 'device') return `device:${auth.vehicleId}`
  return `user:${auth.user?.id || 'unknown'}:${(vehicleScope(auth) || []).slice().sort().join(',')}`
}
function cachedDrives(vehicleId, auth) {
  const scope = vehicleId || (vehicleScope(auth) || []).slice().sort().join(',') || 'all'
  const key = `${authCacheScope(auth)}|${scope}|${telemetryRevision}|${vehicleRevision}`
  if (!tripSummaryCache.has(key)) {
    tripSummaryCache.set(key, segmentDrives(vehicleId || vehicleScope(auth)))
  }
  return tripSummaryCache.get(key)
}
function latestCapture(vehicleId, auth) {
  const key = `${authCacheScope(auth)}|${vehicleId || 'all'}|${telemetryRevision}`
  if (!latestCaptureCache.has(key)) {
    if (sqliteStorage) {
      latestCaptureCache.set(key, sqliteStorage.getLatest(vehicleId, vehicleScope(auth)))
    } else {
      const records = filterRecordsByScope(telemetryDataStore, auth, vehicleId)
      latestCaptureCache.set(key, records.reduce((latest, record) =>
        !latest || Number(record.timestamp) > Number(latest.timestamp) ? record : latest, null))
    }
  }
  return latestCaptureCache.get(key)
}

const { getMaintenanceItems, getMaintenanceStatus } = maintenanceRoutes.createMaintenanceHelpers({
  fuelLogsStore,
  maintenanceStore,
  filterRecordsByScope
});


function isValidVehicleName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 64
}


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


const INSTALL_SCRIPT_PATH = process.env.OBD_INSTALL_SCRIPT
  || (fs.existsSync('/app/install.sh')
      ? '/app/install.sh'
      : path.join(__dirname, '..', 'static', 'install.sh'));


const helmet = require('@fastify/helmet')
const rateLimit = require('@fastify/rate-limit')

// 1. Helmet headers
fastify.register(helmet)

// 2. Global Rate Limiter
fastify.register(rateLimit, {
  global: true,
  max: 5000, // global limit: 5000 reqs per 15 min allows dashboard 3s polling across multiple endpoints
  timeWindow: '15 minutes'
})

// 3. Dynamic CORS based on configured dashboard and public URLs
const defaultOrigins = [
  'https://obd.hon2838.name.my',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3003',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3003'
]
const configuredDashboardUrl = (process.env.DASHBOARD_PUBLIC_URL || process.env.PUBLIC_DASHBOARD_URL || '').trim().replace(/\/+$/, '')
if (configuredDashboardUrl && !defaultOrigins.includes(configuredDashboardUrl)) {
  defaultOrigins.push(configuredDashboardUrl)
}
if (process.env.CORS_ALLOWED_ORIGINS) {
  process.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean).forEach(orig => {
    if (!defaultOrigins.includes(orig)) defaultOrigins.push(orig)
  })
}

fastify.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (defaultOrigins.includes(origin)) return cb(null, true)
    if (process.env.NODE_ENV !== 'production') return cb(null, true)
    return cb(new Error(`Origin ${origin} not allowed by CORS`), false)
  },
  credentials: true
})

// Shared by authorization and export handlers so drive segmentation is not
// performed twice for one export request.
const getDriveBounds = (driveId) => {
  const hasTelemetry = sqliteStorage ? (sqliteStorage.count() > 0) : (telemetryDataStore.length > 0)
  if (!hasTelemetry) return null
  if (!allDriveBoundsCache) allDriveBoundsCache = segmentDrives()
  const target = String(driveId)
  return allDriveBoundsCache.find(drive => String(drive.id) === target) || null
}

const stores = {
  getVehicle: (id) => vehiclesStore.find(v => v.id === id),
  getDevice: (id) => devicesStore.find(d => d.id === id),
  getFuelLog: (id) => fuelLogsStore.find(r => String(r.id) === String(id)),
  getMaintenanceItem: (id) => maintenanceStore.find(r => String(r.id) === String(id)),
  // Reuse the same cached bounds lookup as the export handler. The closure is
  // invoked only after route registration, when getDriveBounds is initialized.
  getDrive: (id) => getDriveBounds(id),
}
installAuthorization(fastify, stores, authenticateRequest)

let SERVER_STARTED_AT = Date.now();
fastify.register(async function apiRoutes(fastify) {

// Schema for telemetry items
const telemetryRecordSchema = {
  type: 'object',
  required: ['timestamp'],
  properties: {
    timestamp: { type: 'number' },
    vehicleId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
    eventId: { type: 'string', minLength: 1, maxLength: 256 },
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
    mafGps: { type: ['number', 'null'] },
    fuelSystemStatus: { type: ['integer', 'null'] },
    estimatedFuelRateLph: { type: ['number', 'null'] },
    estimatedFuelEconomyKmL: { type: ['number', 'null'] },
    iat: { type: ['number', 'null'] },
    map: { type: ['number', 'null'] },
    ambientTemp: { type: ['number', 'null'] },
    voltage: { type: ['number', 'null'] },
    batteryVoltage: { type: ['number', 'null'] },
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
  const payload = request.body;
  return serializeMutation(async () => {
    try {
      if (payload.length > 100) {
        return reply.status(400).send({ error: 'Batch must contain no more than 100 items' });
      }

      const numericBounds = {
        latitude: [-90, 90],
        longitude: [-180, 180],
        speed: [0, 500],
        rpm: [0, 20000],
        coolantTemp: [-50, 250],
        fuelLevel: [0, 100],
        mafGps: [0, 655.35],
        fuelSystemStatus: [0, 255],
        estimatedFuelRateLph: [0, 1000],
        estimatedFuelEconomyKmL: [0, 1000000],
        iat: [-50, 150],
        map: [0, 500],
        batteryVoltage: [0, 36],
        voltage: [0, 36]
      };
      const minimumTimestamp = 1577836800000;
      const maximumTimestamp = Date.now() + 86400000;
      for (const record of payload) {
        if (!Number.isFinite(record.timestamp) || record.timestamp < minimumTimestamp || record.timestamp > maximumTimestamp) {
          return reply.status(400).send({ error: 'Invalid telemetry timestamp' });
        }
        for (const [field, [minimum, maximum]] of Object.entries(numericBounds)) {
          const value = record[field];
          if (value !== undefined && value !== null && (!Number.isFinite(value) || value < minimum || value > maximum)) {
            return reply.status(400).send({ error: `Invalid telemetry field: ${field}` });
          }
        }
        if (record.vehicleId !== undefined && !vehicleExists(record.vehicleId)) {
          return reply.status(400).send({ error: `Unknown vehicleId: ${record.vehicleId}` });
        }
      }

      if (payload.some(record => Object.prototype.hasOwnProperty.call(record, 'ingestSeq'))) {
        return reply.status(400).send({ error: 'ingestSeq is server-assigned and must not be supplied' });
      }
      const normalized = payload.map(record => ({
        timestamp: record.timestamp,
        vehicleId: record.vehicleId || DEFAULT_VEHICLE_ID,
        ...(record.eventId !== undefined ? { eventId: record.eventId } : {}),
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
        mafGps: record.mafGps,
        fuelSystemStatus: record.fuelSystemStatus,
        estimatedFuelRateLph: record.estimatedFuelRateLph,
        estimatedFuelEconomyKmL: record.estimatedFuelEconomyKmL,
        iat: record.iat,
        map: record.map,
        ambientTemp: record.ambientTemp,
        voltage: record.voltage,
        batteryVoltage: record.batteryVoltage,
        accelTime: record.accelTime,
        alertCoolant: record.alertCoolant,
        alertVoltage: record.alertVoltage,
        accOn: record.accOn,
        headlightOn: record.headlightOn,
        volume: record.volume,
        wifiSsid: record.wifiSsid,
        btConnected: record.btConnected,
        receivedAt: Date.now()
      }));
      const classified = sqliteStorage
        ? sqliteStorage.classifyBatchEventIds(normalized)
        : classifyEventIds(telemetryDataStore, normalized, telemetryEventKeySet);
      const accepted = classified.accepted.map((record, index) => ({
        ...record,
        ingestSeq: nextIngestSeq + index + 1
      }));
      const acceptedIds = accepted.flatMap(record => eventIdOf(record) ? [eventIdOf(record)] : []);
      const duplicateIds = classified.duplicate;

      const batchVehicles = new Set(normalized.map(r => r.vehicleId));
      const protocolV2 = request.headers['x-obd-command-protocol'] === '2';
      const now = Date.now();
      const expiredAny = pendingCommands.some(command => command.status === 'pending' && command.expiresAt <= now);
      const liveCommands = expiredAny ? pendingCommands.map(command =>
        command.status === 'pending' && command.expiresAt <= now
          ? { ...command, status: 'expired', updatedAt: now, result: { reason: 'command_expired' } }
          : command
      ) : pendingCommands;
      const commandsToSend = liveCommands.filter(c => c.status === 'pending' && batchVehicles.has(c.vehicleId));
      const remainingCommands = protocolV2 ? liveCommands : liveCommands.map(command =>
        commandsToSend.some(sent => sent.id === command.id)
          ? { ...command, status: 'unknown', updatedAt: now, result: { reason: 'legacy_delivery_unacknowledged' } }
          : command
      );
      const commandQueueChanged = expiredAny || (!protocolV2 && commandsToSend.length > 0);

      // Legacy clients retain one-shot delivery. V2 clients get stable IDs
      // and commands remain pending until an explicit device acknowledgment.
      // Legacy delivery and telemetry still commit together so a failed write
      // cannot cause the command to be sent twice.
      if (sqliteStorage) {
        if (commandQueueChanged) {
          runFileTransactionSync([[COMMANDS_QUEUE_PATH, remainingCommands]], {
            type: 'append', records: accepted
          });
        } else {
          sqliteStorage.appendBatch(accepted);
        }
      } else if (accepted.length > 0 || commandQueueChanged) {
        const candidate = telemetryDataStore.concat(accepted);
        const ingestEntries = [[DB_PATH, candidate]];
        if (commandQueueChanged) ingestEntries.push([COMMANDS_QUEUE_PATH, remainingCommands]);
        runFileTransactionSync(ingestEntries);
      }
      if (!sqliteStorage) {
        telemetryDataStore.push(...accepted);
        for (const record of accepted) {
          const key = telemetryEventKey(record);
          if (key) telemetryEventKeySet.add(key);
        }
        updateTelemetrySequenceIndexAfterAppend(accepted);
      }
      nextIngestSeq += accepted.length;
      const affectedVehicles = new Set(accepted.map(record => record.vehicleId || DEFAULT_VEHICLE_ID));
      for (const vehicleId of affectedVehicles) {
        invalidateAnalyticsCaches({ telemetry: true, vehicleId });
      }

      if (commandQueueChanged) {
        pendingCommands = remainingCommands;
      }
      const commandsForResponse = protocolV2
        ? commandsToSend.map(({ id, command, vehicleId, expiresAt }) => ({ id, command, vehicleId, expiresAt }))
        : commandsToSend.map(c => c.command);

      return reply.status(201).send({
        success: true,
        message: `Ingested ${accepted.length} records successfully.`,
        acceptedIds,
        duplicateIds,
        commands: commandsForResponse
      });
    } catch (err) {
      return retryablePersistenceError(reply, request, err);
    }
  });
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
// V2 commands keep stable IDs and remain pending until the paired device
// acknowledges a durable result. Legacy clients keep one-shot delivery, with
// the result recorded as unknown because their response cannot be correlated.
// Pending commands expire after 24 hours and only the 100 newest terminal
// entries are retained for status and idempotent acknowledgment retries.
  fastify.register(commandsRoutes, {
    DEFAULT_VEHICLE_ID,
    COMMANDS_QUEUE_PATH,
    vehicleExists,
    getPendingCommands: () => pendingCommands,
    setPendingCommands: (nextQueue) => { pendingCommands = nextQueue; },
    canAccessVehicle,
    vehicleScope,
    vehiclesStore,
    getDiagnosticsStore: () => diagnosticsStore,
    setDiagnosticsStore: (next) => { diagnosticsStore = next; },
    dtcHistoryStore,
    DIAG_PATH,
    DTC_HIST_PATH,
    runFileTransactionSync,
    parseDtcCodes: require('./routes/dtc').parseDtcCodes,
    serializeMutation,
    persist,
    retryablePersistenceError
  });

  fastify.register(dtcRoutes, {
    vehicleExists,
    DEFAULT_VEHICLE_ID,
    serializeMutation,
    getDiagnosticsStore: () => diagnosticsStore,
    setDiagnosticsStore: (d) => { diagnosticsStore = d; },
    dtcHistoryStore,
    DIAG_PATH,
    DTC_HIST_PATH,
    runFileTransactionSync,
    retryablePersistenceError,
    resolveVehicleQuery,
    filterRecordsByScope,
    vehicleScope
  });

// GET all acceleration runs
  fastify.register(performanceRoutes, {
    resolveVehicleQuery,
    cachedDrives,
    filterRecordsByScope,
    telemetryDataStore,
    DEFAULT_VEHICLE_ID,
    getRecordSpeed,
    sqliteStorage,
    vehicleScope
  });

  fastify.register(exportRoutes, {
    getDriveBounds,
    telemetryDataStore,
    DEFAULT_VEHICLE_ID,
    getRecordSpeed,
    sqliteStorage
  });

// Endpoint to detect and segment drives
fastify.get('/api/drives', async (request, reply) => {
  const vehicle = resolveVehicleQuery(request.query);
  if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });
  const formattedDrives = cachedDrives(vehicle, request.auth);
  return reply.send([...formattedDrives].reverse()); // Newest drives first
})

// Endpoint to fetch leaderboard of trips
fastify.get('/api/trips/leaderboard', async (request, reply) => {
  const vehicle = resolveVehicleQuery(request.query);
  if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' });
  const drives = cachedDrives(vehicle, request.auth);
  if (drives.length === 0) {
    return reply.send({
      best_efficiency: [],
      longest_distance: [],
      highest_speed: [],
      longest_duration: []
    });
  }

  // Rank only estimates with >=80% capture-span coverage and >=1km of paired
  // distance. Tank-level changes and uncovered intervals are never ranked.
  const validForEfficiency = drives.filter(d => d.summary.quality.efficiencyLeaderboardEligible);

  const bestEfficiency = [...validForEfficiency]
    .sort((a, b) => b.summary.estimatedFuelEconomyKmL - a.summary.estimatedFuelEconomyKmL)
    .slice(0, 5);

  const longestDistance = drives.filter(d => d.summary.distanceKm !== null)
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

// Endpoint for the frontend dashboard to fetch data. Raw pages are capped even
// when a time range is supplied; clients can use the headers to request another
// page rather than mistaking a bounded response for a complete range.
const MAX_HISTORY_PAGE_SIZE = 5000
const DEFAULT_HISTORY_PAGE_SIZE = 1000
fastify.get('/api/telemetry/history', async (request, reply) => {
  const { start, end, minutes, limit, offset } = request.query
  const vehicle = resolveVehicleQuery(request.query)
  if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' })

  const hasStart = start !== undefined
  const hasEnd = end !== undefined
  if (hasStart !== hasEnd) {
    return reply.status(400).send({ error: 'start and end must be supplied together' })
  }
  if (hasStart && minutes !== undefined) {
    return reply.status(400).send({ error: 'minutes cannot be combined with start/end' })
  }

  let startTime = null
  let endTime = null
  if (hasStart) {
    const parsedStart = parseStrictQueryInteger(String(start), 'start')
    const parsedEnd = parseStrictQueryInteger(String(end), 'end')
    if (parsedStart.error || parsedEnd.error) {
      return reply.status(400).send({ error: parsedStart.error || parsedEnd.error })
    }
    startTime = parsedStart.value
    endTime = parsedEnd.value
    if (startTime > endTime) return reply.status(400).send({ error: 'start must not be after end' })
  }

  let cutoff = null
  if (minutes !== undefined) {
    const parsedMinutes = parseStrictQueryInteger(String(minutes), 'minutes', { min: 1 })
    if (parsedMinutes.error) return reply.status(400).send({ error: parsedMinutes.error })
    cutoff = Date.now() - parsedMinutes.value * 60 * 1000
  }

  let cap = DEFAULT_HISTORY_PAGE_SIZE
  if (limit !== undefined) {
    const parsedLimit = parseStrictQueryInteger(String(limit), 'limit', { min: 1, max: MAX_HISTORY_PAGE_SIZE })
    if (parsedLimit.error) return reply.status(400).send({ error: parsedLimit.error })
    cap = parsedLimit.value
  }

  let pageOffset = 0
  if (offset !== undefined) {
    const parsedOffset = parseStrictQueryInteger(String(offset), 'offset')
    if (parsedOffset.error) return reply.status(400).send({ error: parsedOffset.error })
    pageOffset = parsedOffset.value
  }

  // Keep only the requested page while scanning. For the legacy unpaged
  // view, retain the historical tail semantics; ranged callers get a
  // forward page and an offset for fetching the remainder.
  const tailMode = offset === undefined && !hasStart && !hasEnd
  let records = []
  let totalMatched = 0
  if (sqliteStorage) {
    const historyResult = sqliteStorage.getHistory({
      startTime,
      endTime,
      cutoff,
      cap,
      pageOffset,
      tailMode,
      requestedVehicleId: vehicle,
      authorizedScope: vehicleScope(request.auth)
    })
    records = historyResult.records
    totalMatched = historyResult.totalMatched
  } else {
    const tailRecords = tailMode ? new Array(cap) : null
    let tailCount = 0
    let tailWriteIndex = 0
    for (const record of telemetryDataStore) {
      if (!recordIsVisibleToScope(record, request.auth, vehicle)) continue
      if (startTime !== null && (record.timestamp < startTime || record.timestamp > endTime)) continue
      if (cutoff !== null && record.timestamp < cutoff) continue
      if (tailMode) {
        tailRecords[tailWriteIndex] = record
        tailWriteIndex = (tailWriteIndex + 1) % cap
        tailCount = Math.min(tailCount + 1, cap)
      } else if (totalMatched >= pageOffset && records.length < cap) {
        records.push(record)
      }
      totalMatched++
    }
    if (tailMode) {
      records = []
      const startIndex = tailCount < cap ? 0 : tailWriteIndex
      for (let index = 0; index < tailCount; index++) {
        records.push(tailRecords[(startIndex + index) % cap])
      }
    }
  }
  const complete = tailMode
    ? totalMatched <= cap
    : pageOffset + records.length >= totalMatched
  const nextOffset = pageOffset + records.length
  reply.header('X-Telemetry-Page-Limit', String(cap))
  reply.header('X-Telemetry-Page-Offset', String(pageOffset))
  reply.header('X-Telemetry-Page-Complete', String(complete))
  reply.header('X-Telemetry-Total-Matched', String(totalMatched))
  if (!complete && !tailMode) reply.header('X-Telemetry-Next-Offset', String(nextOffset))
  return reply.send(records)
})

// Return a consistent bounded chronological tail and the global ingest cursor
// captured at the same point. Since handlers run synchronously on the event
// loop, no ingest can interleave between capturing the cursor and selecting it.
fastify.get('/api/telemetry/snapshot', async (request, reply) => {
  const vehicle = resolveVehicleQuery(request.query)
  if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' })
  const rawLimit = request.query?.limit === undefined ? String(DEFAULT_HISTORY_PAGE_SIZE) : String(request.query.limit)
  const parsedLimit = parseStrictQueryInteger(rawLimit, 'limit', { min: 1, max: 2000 })
  if (parsedLimit.error) return reply.status(400).send({ error: parsedLimit.error })

  const snapshotCursor = nextIngestSeq
  const records = sqliteStorage
    ? sqliteStorage.getSnapshotTail(
        parsedLimit.value,
        snapshotCursor,
        vehicle,
        vehicleScope(request.auth)
      )
    : selectChronologicalTail(
        telemetryDataStore,
        parsedLimit.value,
        record => Number(record.ingestSeq || 0) <= snapshotCursor &&
          recordIsVisibleToScope(record, request.auth, vehicle)
      )
  return reply.send({ records, snapshotCursor })
})

// Server-side chart series. The result is always chronological and bounded;
// downsampling keeps global speed/RPM peaks in addition to first and last.
fastify.get('/api/telemetry/series', async (request, reply) => {
  const vehicle = resolveVehicleQuery(request.query)
  if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' })
  if (request.query?.start === undefined || request.query?.end === undefined) {
    return reply.status(400).send({ error: 'start and end are required' })
  }
  const parsedStart = parseStrictQueryInteger(String(request.query.start), 'start')
  const parsedEnd = parseStrictQueryInteger(String(request.query.end), 'end')
  if (parsedStart.error || parsedEnd.error) {
    return reply.status(400).send({ error: parsedStart.error || parsedEnd.error })
  }
  if (parsedStart.value > parsedEnd.value) return reply.status(400).send({ error: 'start must not be after end' })
  const rawPoints = request.query?.points === undefined ? '750' : String(request.query.points)
  const parsedPoints = parseStrictQueryInteger(rawPoints, 'points', { min: 1, max: 2000 })
  if (parsedPoints.error) return reply.status(400).send({ error: parsedPoints.error })

  let records
  if (sqliteStorage) {
    records = sqliteStorage.getSeries(
      parsedStart.value,
      parsedEnd.value,
      vehicle,
      vehicleScope(request.auth)
    )
  } else {
    records = telemetryDataStore.filter(record =>
      record.timestamp >= parsedStart.value && record.timestamp <= parsedEnd.value &&
      recordIsVisibleToScope(record, request.auth, vehicle))
    records.sort(chronologicalRecordCompare)
  }
  return reply.send(downsampleTelemetrySeries(records, parsedPoints.value))
})

// Lightweight single-record endpoint for dashboard live polling. Capture time,
// not array order, defines "latest" so a late-arriving sample is handled correctly.
fastify.get('/api/telemetry/latest', async (request, reply) => {
  const vehicle = resolveVehicleQuery(request.query)
  if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' })
  return reply.send(latestCapture(vehicle, request.auth))
})

// Incremental change feed. The cursor is a server ingest sequence, not a
// client-supplied sequence. Filtering advances past inaccessible records.
fastify.get('/api/telemetry/changes', async (request, reply) => {
  const rawCursor = request.query?.cursor === undefined ? '0' : String(request.query.cursor)
  const rawLimit = request.query?.limit === undefined ? '100' : String(request.query.limit)
  if (!/^\d+$/.test(rawCursor) || !/^\d+$/.test(rawLimit)) {
    return reply.status(400).send({ error: 'cursor and limit must be nonnegative integers' })
  }
  const cursor = Number(rawCursor)
  const limit = Number(rawLimit)
  if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    return reply.status(400).send({ error: 'limit must be between 1 and 1000' })
  }
  const vehicle = resolveVehicleQuery(request.query)
  if (vehicle === undefined) return reply.status(400).send({ error: 'Unknown vehicleId' })

  if (sqliteStorage) {
    const changeResult = sqliteStorage.getChanges(cursor, limit, vehicle, vehicleScope(request.auth))
    lastChangesInspectedRows = changeResult.inspected
    return reply.send({
      records: changeResult.records,
      nextCursor: changeResult.nextCursor,
      hasMore: changeResult.hasMore
    })
  }

  let index = telemetryCanBinarySeek() ? firstIngestSequenceAfter(telemetryDataStore, cursor) : 0
  const records = []
  let nextCursor = cursor
  let inspected = 0
  for (; index < telemetryDataStore.length; index++) {
    const record = telemetryDataStore[index]
    inspected++
    if (Number(record.ingestSeq) <= cursor) continue
    nextCursor = Number(record.ingestSeq)
    if (recordIsVisibleToScope(record, request.auth, vehicle)) records.push(record)
    if (records.length >= limit) { index++; break }
  }
  lastChangesInspectedRows = inspected
  const hasMore = index < telemetryDataStore.length
  return reply.send({ records, nextCursor, hasMore })
})

  fastify.register(fuelRoutes, {
    serializeMutation,
    validateEventId,
    vehicleExists,
    DEFAULT_VEHICLE_ID,
    classifyEventIds,
    fuelLogsStore,
    FUEL_PATH,
    persist,
    replaceArrayContents,
    invalidateAnalyticsCaches,
    eventIdOf,
    retryablePersistenceError,
    resolveVehicleQuery,
    filterRecordsByScope
  });

  fastify.register(maintenanceRoutes, {
    serializeMutation,
    validateEventId,
    vehicleExists,
    DEFAULT_VEHICLE_ID,
    classifyEventIds,
    maintenanceStore,
    fuelLogsStore,
    MAINT_PATH,
    persist,
    replaceArrayContents,
    invalidateAnalyticsCaches,
    eventIdOf,
    retryablePersistenceError,
    resolveVehicleQuery,
    filterRecordsByScope,
    filterByVehicle
  });

  fastify.register(vehiclesRoutes, {
    vehicleScope,
    vehiclesStore,
    telemetryDataStore,
    fuelLogsStore,
    maintenanceStore,
    dtcHistoryStore,
    getDiagnosticsStore: () => diagnosticsStore,
    setDiagnosticsStore: (d) => { diagnosticsStore = d; },
    getPendingCommands: () => pendingCommands,
    setPendingCommands: (nextQueue) => { pendingCommands = nextQueue; },
    devicesStore,
    usersStore,
    DEFAULT_VEHICLE_ID,
    VEHICLE_ID_PATTERN,
    isValidVehicleName,
    vehicleExists,
    serializeMutation,
    runFileTransactionSync,
    persist,
    replaceArrayContents,
    invalidateAnalyticsCaches,
    syncTelemetryEventKeySet,
    retryablePersistenceError,
    VEHICLES_PATH,
    USERS_PATH,
    DB_PATH,
    FUEL_PATH,
    MAINT_PATH,
    DTC_HIST_PATH,
    DIAG_PATH,
    COMMANDS_QUEUE_PATH,
    DEVICES_PATH,
    sqliteStorage
  });

  fastify.register(authRoutes, {
    OBD_API_KEY,
    usersStore,
    vehiclesStore,
    devicesStore,
    sessionsStore,
    pendingPairingsByCode,
    pendingPairingsByToken,
    cleanExpiredPairings,
    constantTimeEquals,
    newSession,
    setSessionCookie,
    clearSessionCookie,
    parseCookies,
    SESSION_COOKIE,
    verifyPassword,
    hashPasswordAsync,
    authenticateRequest,
    canAccessVehicle,
    isAdmin,
    vehicleScope,
    vehicleExists,
    serializeMutation,
    runFileTransactionSync,
    persist,
    replaceArrayContents,
    retryablePersistenceError,
    invalidateAnalyticsCaches,
    getIsPoisoned: () => isServerPoisoned,
    DEFAULT_VEHICLE_ID,
    USERS_PATH,
    VEHICLES_PATH,
    DEVICES_PATH,
    INITIAL_ADMIN_SECRET_PATH
  });

// Liveness + readiness probe. Used by the container HEALTHCHECK
// and external uptime monitors. Returns 200 with build identity
// (version + commit) and a snapshot of the in-memory data store
// size. No auth required: the point of a healthcheck is that
// an external probe (k8s, compose, an uptime monitor) can call
// it without credentials. We deliberately do NOT include any
// secrets in the response.
  // Register modular domain route plugins
  fastify.register(healthRoutes, {
    stores: {
      getTelemetryCount: () => sqliteStorage ? sqliteStorage.count() : telemetryDataStore.length,
      telemetryDataStore,
      fuelLogsStore,
      maintenanceStore
    },
    getStartedAt: () => SERVER_STARTED_AT
  });

  fastify.register(agentRoutes, {
    apkDownloadPath: APK_DOWNLOAD_PATH,
    installScriptPath: INSTALL_SCRIPT_PATH,
    readApkVersion: _readApkVersion
  });

}); // end apiRoutes

// Run the server!
const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000
    const host = process.env.HOST || '0.0.0.0'
    await fastify.listen({ port, host })
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

module.exports = {
  fastify,
  segmentDrives,
  getHaversineDistance,
  telemetryDataStore,
  telemetryEventKeySet,
  vehiclesStore,
  fuelLogsStore,
  maintenanceStore,
  usersStore,
  devicesStore,
  sessionsStore,
  pendingPairingsByToken,
  pendingPairingsByCode,
  hashPassword,
  hashPasswordSync,
  verifyPassword,
  authenticateRequest,
  migrateDeviceTokensAtRest,
  runFileTransactionSync,
  recoverPendingTransactionsSync,
  serializeMutation,
  isPoisoned,
  _resetPoisonStateForTesting,
  fsyncFile,
  fsyncDir,
  fsyncFileSync,
  fsyncDirSync,
  COMMANDS_QUEUE_PATH,
  getPendingCommands: () => pendingCommands,
  DEFAULT_VEHICLE_ID,
  USERS_PATH,
  DEVICES_PATH,
  VEHICLES_PATH,
  downsampleTelemetrySeries,
  refreshTelemetrySequenceIndexForTesting,
  getLastChangesInspectedRows: () => lastChangesInspectedRows,
  replaceArrayContents,
  sqliteStorage,
  getStorageEngine: () => STORAGE_ENGINE
}
