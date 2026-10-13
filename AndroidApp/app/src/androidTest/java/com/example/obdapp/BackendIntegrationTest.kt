package com.example.obdapp

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BackendIntegrationTest {

    private val testApiKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    private val isolatedServerUrl = "http://10.0.2.2:3333"

    @Test
    fun testEndToEndIngestOfIatAndMap() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = AppDatabase.getDatabase(context)
        val dao = db.telemetryDao()

        // 1. Configure test backend target and credentials
        saveApiBaseUrl(context, isolatedServerUrl)
        saveApiKey(context, testApiKey)
        saveDeviceToken(context, null)

        // 2. Insert test telemetry record with discrete IAT and MAP into Room v11
        val eventId = "e2e-iat-map-${System.currentTimeMillis()}"
        val record = TelemetryEntity(
            timestamp = System.currentTimeMillis(),
            eventId = eventId,
            vehicleId = "default",
            rpm = 2400,
            speed = 65,
            coolantTemp = 91,
            latitude = 3.1415,
            longitude = 101.6869,
            altitude = 45.0,
            gpsSpeed = 65.0f,
            engineLoad = 35,
            throttlePos = 18,
            fuelLevel = 75,
            ambientTemp = 31,
            voltage = 14.1f,
            iat = 41,
            map = 106,
            synced = false
        )
        dao.insert(record)

        // Verify inserted locally as unsynced
        val unsyncedBefore = dao.getUnsyncedRecordsForVehicle("default")
        assertTrue("Record must exist unsynced before upload", unsyncedBefore.any { it.eventId == eventId })

        // 3. Trigger outbox upload using real app OutboxUploader
        val drainReport = OutboxUploader.drainOutbox(context)
        assertTrue("Drain outbox should report success: $drainReport", drainReport.hadSuccess)

        // 4. Verify locally marked synced = true
        val unsyncedAfter = dao.getUnsyncedRecordsForVehicle("default")
        assertFalse("Record must be marked synced after upload", unsyncedAfter.any { it.eventId == eventId })

        // 5. Query the isolated backend directly from the app to verify it persisted discrete IAT and MAP
        val latestRes = HttpTransport.getJson("$isolatedServerUrl/api/telemetry/latest?vehicle=default", context)
        assertTrue("Backend query must succeed: ${latestRes.statusCode} ${latestRes.body}", latestRes.isSuccess)

        val json = JSONObject(latestRes.body)
        assertEquals("Backend must return the uploaded eventId", eventId, json.optString("eventId"))
        assertEquals("Backend must return discrete IAT", 41, json.optInt("iat"))
        assertEquals("Backend must return discrete MAP", 106, json.optInt("map"))
    }
}
