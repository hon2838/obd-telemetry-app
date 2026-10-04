package com.example.obdapp

import android.content.Context
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.runner.RunWith

/**
 * Instrumented variant of the 7 -> 8 migration test (see the Robolectric
 * Migration7To8JvmTest for the JVM-executed equivalent). Requires a
 * device or emulator; run with connectedDebugAndroidTest.
 *
 * No exported schema JSON is used: the v7 database file is built directly
 * with the pre-optimization DDL, then opened through Room with
 * MIGRATION_7_8. Room validates the migrated schema against the v8
 * entities on open (columns, nullability, defaults, indices) and throws on
 * any mismatch, which is exactly the release-blocking check.
 */
@RunWith(AndroidJUnit4::class)
class Migration7To8Test {

    private fun context(): Context =
        ApplicationProvider.getApplicationContext()

    private fun dbName(test: String) = "migration-7-8-$test"

    private fun createV7Schema(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE `telemetry_data` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                "`timestamp` INTEGER NOT NULL, `rpm` INTEGER, `speed` INTEGER, `coolantTemp` INTEGER, " +
                "`latitude` REAL NOT NULL, `longitude` REAL NOT NULL, `altitude` REAL NOT NULL, " +
                "`gpsSpeed` REAL NOT NULL, `engineLoad` INTEGER, `throttlePos` INTEGER, " +
                "`fuelLevel` INTEGER, `ambientTemp` INTEGER, `voltage` REAL, `accelTime` REAL, " +
                "`alertCoolant` INTEGER, `alertVoltage` INTEGER, `accOn` INTEGER, `headlightOn` INTEGER, " +
                "`volume` INTEGER, `wifiSsid` TEXT, `btConnected` INTEGER, " +
                "`vehicleId` TEXT NOT NULL DEFAULT 'default', `synced` INTEGER NOT NULL)"
        )
        db.execSQL(
            "CREATE TABLE `fuel_logs` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                "`timestamp` INTEGER NOT NULL, `litres` REAL NOT NULL, `odometer` REAL NOT NULL, " +
                "`vehicleId` TEXT NOT NULL DEFAULT 'default', `synced` INTEGER NOT NULL)"
        )
        db.execSQL(
            "CREATE TABLE `maintenance_items` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                "`serverId` TEXT NOT NULL, `name` TEXT NOT NULL, `intervalKm` REAL, `intervalDays` INTEGER, " +
                "`lastServiceOdo` REAL, `lastServiceDate` INTEGER, `notes` TEXT NOT NULL, " +
                "`vehicleId` TEXT NOT NULL DEFAULT 'default', `synced` INTEGER NOT NULL)"
        )
    }

    // Builds a real v7 database file directly, then opens it through Room
    // with MIGRATION_7_8 (which migrates and Room-validates on open).
    private fun createV7Database(name: String, seed: SupportSQLiteDatabase.() -> Unit): AppDatabase {
        val ctx = context()
        ctx.deleteDatabase(name)
        val openHelper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(ctx)
                .name(name)
                .callback(object : SupportSQLiteOpenHelper.Callback(7) {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        createV7Schema(db)
                    }

                    override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) {
                        throw IllegalStateException("unexpected upgrade $oldVersion -> $newVersion")
                    }
                })
                .build()
        )
        openHelper.writableDatabase.apply {
            seed()
            close()
        }
        openHelper.close()
        return Room.databaseBuilder(ctx, AppDatabase::class.java, name)
            .addMigrations(AppDatabase.MIGRATION_7_8, AppDatabase.MIGRATION_8_9, AppDatabase.MIGRATION_9_10)
            .build()
    }

    @Test
    fun migrate7To8_preservesPendingRowsAndBackfillsEventIds() {
        val roomDb = createV7Database(dbName("rows")) {
            // Pending telemetry rows (one per vehicle to cover the per-vehicle outbox).
            execSQL(
                "INSERT INTO `telemetry_data` (`timestamp`, `rpm`, `speed`, `coolantTemp`, `latitude`, " +
                    "`longitude`, `altitude`, `gpsSpeed`, `vehicleId`, `synced`) VALUES " +
                    "(7001, 1500, 60, 90, 1.0, 2.0, 3.0, 60.0, 'default', 0), " +
                    "(7002, 1600, 61, 91, 1.1, 2.1, 3.1, 61.0, 'review-car', 0)"
            )
            execSQL(
                "INSERT INTO `fuel_logs` (`timestamp`, `litres`, `odometer`, `vehicleId`, `synced`) VALUES " +
                    "(7003, 25.5, 45890.3, 'default', 0)"
            )
            execSQL(
                "INSERT INTO `maintenance_items` (`serverId`, `name`, `intervalKm`, `notes`, `vehicleId`, `synced`) VALUES " +
                    "('srv-1', 'Engine Oil', 10000.0, '', 'default', 0)"
            )
        }
        try {
            val db = roomDb.openHelper.readableDatabase

            // Unique eventId indices exist on every outbox table.
            val indexNames = mutableListOf<String>()
            db.query("SELECT `name` FROM `sqlite_master` WHERE `type` = 'index'").use { cursor ->
                while (cursor.moveToNext()) indexNames.add(cursor.getString(0))
            }
            assertTrue(indexNames.contains("index_telemetry_data_eventId"))
            assertTrue(indexNames.contains("index_fuel_logs_eventId"))
            assertTrue(indexNames.contains("index_maintenance_items_eventId"))

            // Every pre-existing row gained a stable, unique, non-empty eventId.
            for (table in listOf("telemetry_data", "fuel_logs", "maintenance_items")) {
                val ids = mutableListOf<String>()
                db.query("SELECT `eventId` FROM `$table`").use { cursor ->
                    while (cursor.moveToNext()) ids.add(cursor.getString(0) ?: "")
                }
                assertTrue("$table rows kept", ids.isNotEmpty())
                assertTrue("$table eventIds backfilled", ids.all { it.isNotEmpty() })
                assertEquals("$table eventIds unique", ids.size, ids.toSet().size)
            }

            // Pending flags and vehicle routing survived the upgrade.
            db.query("SELECT COUNT(*) FROM `telemetry_data` WHERE `synced` = 0").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(2, cursor.getLong(0))
            }
            db.query("SELECT COUNT(*) FROM `fuel_logs` WHERE `synced` = 0 AND `vehicleId` = 'default'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(1, cursor.getLong(0))
            }
            db.query("SELECT COUNT(*) FROM `maintenance_items` WHERE `synced` = 0 AND `serverId` = 'srv-1'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(1, cursor.getLong(0))
            }
        } finally {
            roomDb.close()
        }
    }

    @Test
    fun migratedDatabase_supportsOutboxEventIdOperations() {
        val roomDb = createV7Database(dbName("ops")) {
            execSQL(
                "INSERT INTO `fuel_logs` (`timestamp`, `litres`, `odometer`, `vehicleId`, `synced`) VALUES " +
                    "(7004, 10.0, 100.0, 'default', 0)"
            )
        }
        try {
            // New inserts get a stable eventId by default and ack-based
            // deletion removes exactly the acknowledged row.
            val dao = roomDb.fuelLogDao()
            runBlocking {
                val before = dao.getUnsyncedLogsForVehicle("default", 50)
                assertEquals(1, before.size)
                val acked = before.first().eventId
                assertTrue(acked.isNotEmpty())
                dao.insert(
                    FuelLogEntity(timestamp = 7005, litres = 11.0, odometer = 200.0, vehicleId = "default")
                )
                assertEquals(2, dao.getUnsyncedLogsForVehicle("default", 50).size)
                dao.deleteByEventIds(listOf(acked))
                val remaining = dao.getUnsyncedLogsForVehicle("default", 50)
                assertEquals(1, remaining.size)
                assertTrue(remaining.none { it.eventId == acked })
            }
        } finally {
            roomDb.close()
        }
    }

    /**
     * Full historical chain 4 -> 8. The v4 DDL mirrors commit 76aa948
     * (telemetry with accel/alert columns, fuel without vehicleId, no
     * maintenance table). Opening through migrations 4-5, 5-6, 6-7 and 7-8
     * must preserve queued rows and pass Room's final schema validation —
     * this is the executed proof for the corrected MIGRATION_4_5 DDL.
     */
    @Test
    fun migrate4To8_preservesQueuedRowsThroughFullChain() {
        val name = dbName("chain")
        val ctx = context()
        ctx.deleteDatabase(name)
        val openHelper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(ctx)
                .name(name)
                .callback(object : SupportSQLiteOpenHelper.Callback(4) {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        db.execSQL(
                            "CREATE TABLE `telemetry_data` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                                "`timestamp` INTEGER NOT NULL, `rpm` INTEGER, `speed` INTEGER, " +
                                "`coolantTemp` INTEGER, `latitude` REAL NOT NULL, `longitude` REAL NOT NULL, " +
                                "`altitude` REAL NOT NULL, `gpsSpeed` REAL NOT NULL, `engineLoad` INTEGER, " +
                                "`throttlePos` INTEGER, `fuelLevel` INTEGER, `ambientTemp` INTEGER, " +
                                "`voltage` REAL, `accelTime` REAL, `alertCoolant` INTEGER, " +
                                "`alertVoltage` INTEGER, `synced` INTEGER NOT NULL)"
                        )
                        db.execSQL(
                            "CREATE TABLE `fuel_logs` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                                "`timestamp` INTEGER NOT NULL, `litres` REAL NOT NULL, " +
                                "`odometer` REAL NOT NULL, `synced` INTEGER NOT NULL)"
                        )
                    }

                    override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) {
                        throw IllegalStateException("unexpected upgrade $oldVersion -> $newVersion")
                    }
                })
                .build()
        )
        openHelper.writableDatabase.apply {
            execSQL(
                "INSERT INTO `telemetry_data` (`timestamp`, `rpm`, `latitude`, `longitude`, `altitude`, " +
                    "`gpsSpeed`, `synced`) VALUES (4001, 1200, 1.0, 2.0, 3.0, 50.0, 0)"
            )
            execSQL(
                "INSERT INTO `fuel_logs` (`timestamp`, `litres`, `odometer`, `synced`) VALUES " +
                    "(4002, 30.0, 10000.0, 0)"
            )
            close()
        }
        openHelper.close()

        val roomDb = Room.databaseBuilder(ctx, AppDatabase::class.java, name)
            .addMigrations(
                AppDatabase.MIGRATION_4_5,
                AppDatabase.MIGRATION_5_6,
                AppDatabase.MIGRATION_6_7,
                AppDatabase.MIGRATION_7_8,
                AppDatabase.MIGRATION_8_9,
                AppDatabase.MIGRATION_9_10
            )
            .build()
        try {
            runBlocking {
                val telemetry = roomDb.telemetryDao().getUnsyncedRecordsForVehicle("default", 50)
                assertEquals(1, telemetry.size)
                assertEquals(4001L, telemetry.first().timestamp)
                assertTrue(telemetry.first().eventId.isNotEmpty())
                val fuel = roomDb.fuelLogDao().getUnsyncedLogsForVehicle("default", 50)
                assertEquals(1, fuel.size)
                assertEquals(4002L, fuel.first().timestamp)
                assertTrue(fuel.first().eventId.isNotEmpty())
                // The maintenance table created mid-chain is fully usable.
                roomDb.maintenanceDao().insert(
                    MaintenanceEntity(
                        serverId = "srv-chain", name = "Chain Check",
                        intervalKm = 5000.0, intervalDays = null,
                        lastServiceOdo = null, lastServiceDate = null,
                        vehicleId = "default"
                    )
                )
                assertEquals(1, roomDb.maintenanceDao().getUnsyncedItemsForVehicle("default", 50).size)
            }
        } finally {
            roomDb.close()
        }
    }
}
