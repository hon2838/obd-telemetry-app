package com.example.obdapp

import android.content.Context
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class Migration9To10JvmTest {
    @Test fun preservesPendingHistoryAndPersistsNewFuelReadings() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "fuel-migration-9-10"
        context.deleteDatabase(name)
        // Build the historical schema, not today's entity definitions.
        val schema = JSONObject(File("schemas/com.example.obdapp.AppDatabase/9.json").readText())
            .getJSONObject("database").getJSONArray("entities")
        val helper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(context).name(name)
                .callback(object : SupportSQLiteOpenHelper.Callback(9) {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        for (index in 0 until schema.length()) {
                            val entity = schema.getJSONObject(index)
                            val table = entity.getString("tableName")
                            db.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", table))
                            val indices = entity.getJSONArray("indices")
                            for (i in 0 until indices.length()) {
                                db.execSQL(indices.getJSONObject(i).getString("createSql").replace("\${TABLE_NAME}", table))
                            }
                        }
                    }
                    override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) =
                        error("Unexpected helper upgrade")
                }).build()
        )
        helper.writableDatabase.execSQL("INSERT INTO telemetry_data (eventId,timestamp,latitude,longitude,altitude,gpsSpeed,vehicleId,synced) VALUES ('pending-old',1234,0,0,0,0,'car',0)")
        helper.close()
        val db = Room.databaseBuilder(context, AppDatabase::class.java, name)
            .addMigrations(AppDatabase.MIGRATION_9_10, AppDatabase.MIGRATION_10_11).build()
        try {
            val original = db.telemetryDao().getUnsyncedRecordsForVehicle("car").single()
            assertEquals("pending-old", original.eventId)
            assertNull(original.mafGps)
            assertNull(original.estimatedFuelEconomyKmL)
            db.telemetryDao().insert(original.copy(
                id = 0, eventId = "pending-fuel", mafGps = 3.24,
                fuelSystemStatus = 2, estimatedFuelRateLph = 1.057959184,
                estimatedFuelEconomyKmL = 0.0
            ))
            val fuel = db.telemetryDao().getUnsyncedRecordsForVehicle("car").first { it.eventId == "pending-fuel" }
            assertEquals(3.24, fuel.mafGps!!, 0.0)
            assertEquals(0.0, fuel.estimatedFuelEconomyKmL!!, 0.0)
            assertFalse(fuel.synced)
        } finally {
            db.close()
            context.deleteDatabase(name)
        }
    }
}
