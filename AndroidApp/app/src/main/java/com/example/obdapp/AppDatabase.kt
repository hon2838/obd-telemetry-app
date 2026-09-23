package com.example.obdapp

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import java.util.UUID

@Database(entities = [TelemetryEntity::class, FuelLogEntity::class, MaintenanceEntity::class, CommandInboxEntity::class], version = 9, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {
    abstract fun telemetryDao(): TelemetryDao
    abstract fun fuelLogDao(): FuelLogDao
    abstract fun maintenanceDao(): MaintenanceDao
    abstract fun commandInboxDao(): CommandInboxDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Version 1 to 2 baseline alignment
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `accelTime` REAL")
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `alertCoolant` INTEGER")
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `alertVoltage` INTEGER")
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `fuel_logs` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `timestamp` INTEGER NOT NULL, `litres` REAL NOT NULL, `odometer` REAL NOT NULL, `synced` INTEGER NOT NULL)"
                )
            }
        }

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Verified against b590880: the v5 MaintenanceEntity carries
                // serverId (non-null, no DB default). The historical 4->5 DDL
                // omitted serverId, which failed Room validation on devices
                // without a destructive fallback. This corrected DDL matches
                // the v5 entity exactly; no DEFAULT clauses, because neither
                // the v5 entity nor Room's generated schema declares any.
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `maintenance_items` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `serverId` TEXT NOT NULL, `name` TEXT NOT NULL, `intervalKm` REAL, `intervalDays` INTEGER, `lastServiceOdo` REAL, `lastServiceDate` INTEGER, `notes` TEXT NOT NULL, `synced` INTEGER NOT NULL)"
                )
            }
        }

        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `accOn` INTEGER")
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `headlightOn` INTEGER")
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `volume` INTEGER")
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `wifiSsid` TEXT")
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `btConnected` INTEGER")
            }
        }

        // Multi-vehicle support: every queued record carries the vehicle it
        // was captured for. Existing rows keep their history bucket by
        // defaulting to 'default' — never wipe local queued data on upgrade.
        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `telemetry_data` ADD COLUMN `vehicleId` TEXT NOT NULL DEFAULT 'default'")
                db.execSQL("ALTER TABLE `fuel_logs` ADD COLUMN `vehicleId` TEXT NOT NULL DEFAULT 'default'")
                db.execSQL("ALTER TABLE `maintenance_items` ADD COLUMN `vehicleId` TEXT NOT NULL DEFAULT 'default'")
            }
        }

        val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Ensure maintenance_items has serverId column if prior migration missed it
                ensureColumnExists(db, "maintenance_items", "serverId", "TEXT NOT NULL DEFAULT ''")

                // 1. Add eventId column to all tables
                ensureColumnExists(db, "telemetry_data", "eventId", "TEXT NOT NULL DEFAULT ''")
                ensureColumnExists(db, "fuel_logs", "eventId", "TEXT NOT NULL DEFAULT ''")
                ensureColumnExists(db, "maintenance_items", "eventId", "TEXT NOT NULL DEFAULT ''")

                // 2. Backfill existing rows with stable unique UUIDs
                backfillTableEventId(db, "telemetry_data")
                backfillTableEventId(db, "fuel_logs")
                backfillTableEventId(db, "maintenance_items")

                // 3. Create indices for pending queries and unique eventId
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_telemetry_data_synced_id` ON `telemetry_data` (`synced`, `id`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_telemetry_data_vehicleId_synced` ON `telemetry_data` (`vehicleId`, `synced`)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_telemetry_data_eventId` ON `telemetry_data` (`eventId`)")

                db.execSQL("CREATE INDEX IF NOT EXISTS `index_fuel_logs_synced_id` ON `fuel_logs` (`synced`, `id`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_fuel_logs_vehicleId_synced` ON `fuel_logs` (`vehicleId`, `synced`)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_fuel_logs_eventId` ON `fuel_logs` (`eventId`)")

                db.execSQL("CREATE INDEX IF NOT EXISTS `index_maintenance_items_synced_id` ON `maintenance_items` (`synced`, `id`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_maintenance_items_vehicleId_synced` ON `maintenance_items` (`vehicleId`, `synced`)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_maintenance_items_eventId` ON `maintenance_items` (`eventId`)")
            }

            private fun ensureColumnExists(db: SupportSQLiteDatabase, table: String, column: String, typeDef: String) {
                try {
                    val cursor = db.query("PRAGMA table_info(`$table`)")
                    var found = false
                    cursor.use { c ->
                        val nameIdx = c.getColumnIndex("name")
                        while (c.moveToNext()) {
                            if (nameIdx >= 0 && c.getString(nameIdx).equals(column, ignoreCase = true)) {
                                found = true
                                break
                            }
                        }
                    }
                    if (!found) {
                        db.execSQL("ALTER TABLE `$table` ADD COLUMN `$column` $typeDef")
                    }
                } catch (_: Exception) { }
            }

            private fun backfillTableEventId(db: SupportSQLiteDatabase, table: String) {
                val cursor = db.query("SELECT `id` FROM `$table` WHERE `eventId` = '' OR `eventId` IS NULL")
                cursor.use { c ->
                    val idIdx = c.getColumnIndex("id")
                    if (idIdx >= 0) {
                        while (c.moveToNext()) {
                            val id = c.getLong(idIdx)
                            val uuid = UUID.randomUUID().toString()
                            db.execSQL("UPDATE `$table` SET `eventId` = ? WHERE `id` = ?", arrayOf<Any>(uuid, id))
                        }
                    }
                }
            }
        }

        val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `command_inbox` (`id` TEXT NOT NULL, `command` TEXT NOT NULL, `vehicleId` TEXT NOT NULL, `state` TEXT NOT NULL, `result` TEXT, `ackStatus` TEXT, `expiresAt` INTEGER, `requiresAck` INTEGER NOT NULL, `createdAt` INTEGER NOT NULL, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_command_inbox_vehicleId_state` ON `command_inbox` (`vehicleId`, `state`)")
            }
        }

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "obd_telemetry_database"
                )
                .addMigrations(
                    MIGRATION_1_2,
                    MIGRATION_2_3,
                    MIGRATION_3_4,
                    MIGRATION_4_5,
                    MIGRATION_5_6,
                    MIGRATION_6_7,
                    MIGRATION_7_8,
                    MIGRATION_8_9
                )
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
