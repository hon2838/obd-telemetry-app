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
class Migration10To11JvmTest {
    @Test fun preservesPendingHistoryAndPersistsNewIatAndMapReadings() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "iat-map-migration-10-11"
        context.deleteDatabase(name)
        // Build the historical schema from 10.json
        val schema = JSONObject(File("schemas/com.example.obdapp.AppDatabase/10.json").readText())
            .getJSONObject("database").getJSONArray("entities")
        val helper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(context).name(name)
                .callback(object : SupportSQLiteOpenHelper.Callback(10) {
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
        helper.writableDatabase.execSQL("INSERT INTO telemetry_data (eventId,timestamp,latitude,longitude,altitude,gpsSpeed,vehicleId,synced) VALUES ('pending-v10',5678,0,0,0,0,'car',0)")
        helper.close()
        val db = Room.databaseBuilder(context, AppDatabase::class.java, name)
            .addMigrations(AppDatabase.MIGRATION_10_11).build()
        try {
            val original = db.telemetryDao().getUnsyncedRecordsForVehicle("car").single()
            assertEquals("pending-v10", original.eventId)
            assertNull(original.iat)
            assertNull(original.map)
            db.telemetryDao().insert(original.copy(
                id = 0,
                eventId = "pending-v11",
                iat = 38,
                map = 101
            ))
            val migrated = db.telemetryDao().getUnsyncedRecordsForVehicle("car").first { it.eventId == "pending-v11" }
            assertEquals(38, migrated.iat)
            assertEquals(101, migrated.map)
            assertFalse(migrated.synced)
        } finally {
            db.close()
            context.deleteDatabase(name)
        }
    }
}
