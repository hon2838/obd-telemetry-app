package com.example.obdapp

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class TelemetrySyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val db = AppDatabase.getDatabase(applicationContext)
            val dao = db.telemetryDao()
            val unsyncedRecords = dao.getUnsyncedRecords()

            if (unsyncedRecords.isEmpty()) {
                return@withContext Result.success()
            }

            val jsonArray = JSONArray()
            unsyncedRecords.forEach { record ->
                val jsonObj = JSONObject().apply {
                    put("timestamp", record.timestamp)
                    put("rpm", record.rpm ?: JSONObject.NULL)
                    put("speed", record.speed ?: JSONObject.NULL)
                    put("coolantTemp", record.coolantTemp ?: JSONObject.NULL)
                    put("latitude", record.latitude)
                    put("longitude", record.longitude)
                    put("altitude", record.altitude)
                    put("gpsSpeed", record.gpsSpeed.toDouble())
                    put("engineLoad", record.engineLoad ?: JSONObject.NULL)
                    put("throttlePos", record.throttlePos ?: JSONObject.NULL)
                    put("fuelLevel", record.fuelLevel ?: JSONObject.NULL)
                    put("ambientTemp", record.ambientTemp ?: JSONObject.NULL)
                    put("voltage", record.voltage?.toDouble() ?: JSONObject.NULL)
                    put("accelTime", record.accelTime ?: JSONObject.NULL)
                    put("alertCoolant", record.alertCoolant ?: JSONObject.NULL)
                    put("alertVoltage", record.alertVoltage ?: JSONObject.NULL)
                }
                jsonArray.put(jsonObj)
            }

            val success = uploadToServer(jsonArray.toString())

            if (success) {
                // Mark as synced
                unsyncedRecords.forEach { it.synced = true }
                dao.updateRecords(unsyncedRecords)
                // Optionally delete synced to save space
                dao.deleteSyncedRecords()
                return@withContext Result.success()
            } else {
                return@withContext Result.retry()
            }

        } catch (e: Exception) {
            e.printStackTrace()
            return@withContext Result.retry()
        }
    }

    private fun uploadToServer(jsonPayload: String): Boolean {
        val prefs = applicationContext.getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
        val apiUrl = prefs.getString("API_URL", "http://127.0.0.1:3000/api/telemetry/batch") ?: "http://127.0.0.1:3000/api/telemetry/batch"
        val url = URL(apiUrl)
        var connection: HttpURLConnection? = null
        return try {
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("X-API-Key", API_KEY)
            connection.doOutput = true
            connection.connectTimeout = 5000
            
            val writer = OutputStreamWriter(connection.outputStream)
            writer.write(jsonPayload)
            writer.flush()
            writer.close()
            
            connection.responseCode in 200..299
        } catch (e: Exception) {
            e.printStackTrace()
            false
        } finally {
            connection?.disconnect()
        }
    }
}
