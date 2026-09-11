package com.example.obdapp

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import androidx.room.withTransaction
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.coroutineContext

enum class UploadBatchStatus {
    SUCCESS_ACKNOWLEDGED,
    INCOMPATIBLE_SERVER,
    FAILED_VEHICLE_AUTH,
    FAILED_PERMANENT_VALIDATION,
    FAILED_NETWORK
}

data class OutboxDrainReport(
    val hadSuccess: Boolean,
    val hadNetworkFailures: Boolean,
    val hadIncompatibleServer: Boolean,
    val blockedVehicles: Set<String> = emptySet(),
    val quarantinedVehicles: Set<String> = emptySet(),
    val quarantinedCount: Int = 0,
    val totalAckedTelemetry: Int = 0,
    val totalAckedFuel: Int = 0,
    val totalAckedMaint: Int = 0
)

object OutboxUploader {

    private const val TAG = "OutboxUploader"

    const val TELEMETRY_PAGE_LIMIT = 100
    const val FUEL_PAGE_LIMIT = 50
    const val MAINT_PAGE_LIMIT = 50
    const val FAIR_PAUSE_MS = 50L

    const val ACTION_INCOMPATIBILITY = "com.example.obdapp.OUTBOX_INCOMPATIBILITY"
    const val EXTRA_MESSAGE = "incompatibility_message"

    private val uploadMutex = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    var commandHandler: ((String) -> Unit)? = null

    @Volatile
    private var networkCallbackRegistered = false

    fun registerConnectivityCallback(context: Context, onNetworkAvailable: (() -> Unit)? = null) {
        if (networkCallbackRegistered) return
        synchronized(this) {
            if (networkCallbackRegistered) return
            try {
                val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                if (cm != null) {
                    val request = NetworkRequest.Builder()
                        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        .build()
                    cm.registerNetworkCallback(request, object : ConnectivityManager.NetworkCallback() {
                        override fun onAvailable(network: Network) {
                            Log.i(TAG, "Network available, triggering outbox drain wakeup")
                            onNetworkAvailable?.invoke()
                            triggerImmediateDrain(context.applicationContext)
                        }
                    })
                    networkCallbackRegistered = true
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to register network callback: ${e.message}")
            }
        }
    }

    fun isNetworkAvailable(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun triggerImmediateDrain(context: Context): Job {
        return scope.launch {
            drainOutbox(context)
        }
    }

    suspend fun drainOutbox(context: Context): OutboxDrainReport {
        // Serialized execution: only one drain runs across the entire application
        return uploadMutex.withLock {
            if (!isDeviceConfigured(context)) {
                Log.d(TAG, "Device not configured with API credentials; skipping outbox drain")
                return@withLock OutboxDrainReport(hadSuccess = false, hadNetworkFailures = false, hadIncompatibleServer = false)
            }

            if (!isNetworkAvailable(context)) {
                Log.d(TAG, "Network not available; preserving outbox in SQLite")
                return@withLock OutboxDrainReport(hadSuccess = false, hadNetworkFailures = false, hadIncompatibleServer = false)
            }

            val db = AppDatabase.getDatabase(context)
            val telemetryDao = db.telemetryDao()
            val fuelDao = db.fuelLogDao()
            val maintDao = db.maintenanceDao()

            var hadSuccess = false
            var hadNetworkFailures = false
            var hadIncompatibleServer = false
            val blockedVehicles = mutableSetOf<String>()
            val quarantinedVehicles = mutableSetOf<String>()
            var quarantinedCount = 0
            var ackedTelemetry = 0
            var ackedFuel = 0
            var ackedMaint = 0

            // Collect distinct vehicles with pending data
            val pendingVehicles = LinkedHashSet<String>()
            val activeVehicle = VehiclePrefs.getActiveVehicleId(context)
            pendingVehicles.add(activeVehicle)
            try {
                pendingVehicles.addAll(telemetryDao.getUnsyncedVehicles())
                pendingVehicles.addAll(fuelDao.getUnsyncedVehicles())
                pendingVehicles.addAll(maintDao.getUnsyncedVehicles())
            } catch (e: Exception) {
                Log.e(TAG, "Failed to query pending vehicles", e)
            }

            for (vehicleId in pendingVehicles) {
                if (coroutineContext[Job]?.isActive == false) break
                // Retryable transport/server failures back off globally; a
                // permanently invalid batch must never starve other vehicles.
                if (hadNetworkFailures) break

                // A permanently rejected resource is skipped for the rest of
                // this drain (no hot loop) while other resources/vehicles
                // continue. Rows are retained in the outbox for inspection.
                var telemetryQuarantined = false
                var fuelQuarantined = false
                var maintQuarantined = false

                // Draining loop for this vehicle
                var vehicleHasMore = true
                while (vehicleHasMore && coroutineContext[Job]?.isActive != false) {
                    var drainedAnyInPass = false

                    // 1. Telemetry page
                    val telemetryBatch = if (telemetryQuarantined) emptyList()
                        else telemetryDao.getUnsyncedRecordsForVehicle(vehicleId, TELEMETRY_PAGE_LIMIT)
                    if (telemetryBatch.isNotEmpty()) {
                        val result = uploadTelemetryBatch(context, db, telemetryDao, vehicleId, telemetryBatch)
                        when (result.status) {
                            UploadBatchStatus.SUCCESS_ACKNOWLEDGED -> {
                                hadSuccess = true
                                drainedAnyInPass = true
                                ackedTelemetry += result.ackedCount
                            }
                            UploadBatchStatus.INCOMPATIBLE_SERVER -> {
                                hadIncompatibleServer = true
                                vehicleHasMore = false
                                break
                            }
                            UploadBatchStatus.FAILED_VEHICLE_AUTH -> {
                                Log.w(TAG, "Vehicle $vehicleId denied access (403); skipping without blocking other vehicles")
                                blockedVehicles.add(vehicleId)
                                vehicleHasMore = false
                                break
                            }
                            UploadBatchStatus.FAILED_PERMANENT_VALIDATION -> {
                                Log.w(TAG, "Telemetry batch for vehicle $vehicleId permanently rejected; quarantining ${telemetryBatch.size} rows, draining other resources/vehicles")
                                telemetryQuarantined = true
                                quarantinedVehicles.add(vehicleId)
                                quarantinedCount += telemetryBatch.size
                            }
                            UploadBatchStatus.FAILED_NETWORK -> {
                                hadNetworkFailures = true
                                vehicleHasMore = false
                                break
                            }
                        }
                        delay(FAIR_PAUSE_MS)
                    }

                    if (hadNetworkFailures) break

                    // 2. Fuel page
                    val fuelBatch = if (fuelQuarantined) emptyList()
                        else fuelDao.getUnsyncedLogsForVehicle(vehicleId, FUEL_PAGE_LIMIT)
                    if (fuelBatch.isNotEmpty()) {
                        val result = uploadFuelBatch(context, db, fuelDao, vehicleId, fuelBatch)
                        when (result.status) {
                            UploadBatchStatus.SUCCESS_ACKNOWLEDGED -> {
                                hadSuccess = true
                                drainedAnyInPass = true
                                ackedFuel += result.ackedCount
                            }
                            UploadBatchStatus.INCOMPATIBLE_SERVER -> {
                                hadIncompatibleServer = true
                                vehicleHasMore = false
                                break
                            }
                            UploadBatchStatus.FAILED_VEHICLE_AUTH -> {
                                blockedVehicles.add(vehicleId)
                                vehicleHasMore = false
                                break
                            }
                            UploadBatchStatus.FAILED_PERMANENT_VALIDATION -> {
                                Log.w(TAG, "Fuel batch for vehicle $vehicleId permanently rejected; quarantining ${fuelBatch.size} rows, draining other resources/vehicles")
                                fuelQuarantined = true
                                quarantinedVehicles.add(vehicleId)
                                quarantinedCount += fuelBatch.size
                            }
                            UploadBatchStatus.FAILED_NETWORK -> {
                                hadNetworkFailures = true
                                vehicleHasMore = false
                                break
                            }
                        }
                        delay(FAIR_PAUSE_MS)
                    }

                    if (hadNetworkFailures) break

                    // 3. Maintenance page
                    val maintBatch = if (maintQuarantined) emptyList()
                        else maintDao.getUnsyncedItemsForVehicle(vehicleId, MAINT_PAGE_LIMIT)
                    if (maintBatch.isNotEmpty()) {
                        val result = uploadMaintenanceBatch(context, db, maintDao, vehicleId, maintBatch)
                        when (result.status) {
                            UploadBatchStatus.SUCCESS_ACKNOWLEDGED -> {
                                hadSuccess = true
                                drainedAnyInPass = true
                                ackedMaint += result.ackedCount
                            }
                            UploadBatchStatus.INCOMPATIBLE_SERVER -> {
                                hadIncompatibleServer = true
                                vehicleHasMore = false
                                break
                            }
                            UploadBatchStatus.FAILED_VEHICLE_AUTH -> {
                                blockedVehicles.add(vehicleId)
                                vehicleHasMore = false
                                break
                            }
                            UploadBatchStatus.FAILED_PERMANENT_VALIDATION -> {
                                Log.w(TAG, "Maintenance batch for vehicle $vehicleId permanently rejected; quarantining ${maintBatch.size} rows, draining other resources/vehicles")
                                maintQuarantined = true
                                quarantinedVehicles.add(vehicleId)
                                quarantinedCount += maintBatch.size
                            }
                            UploadBatchStatus.FAILED_NETWORK -> {
                                hadNetworkFailures = true
                                vehicleHasMore = false
                                break
                            }
                        }
                        delay(FAIR_PAUSE_MS)
                    }

                    if (hadNetworkFailures || !drainedAnyInPass) {
                        vehicleHasMore = false
                    } else {
                        // Check if more remains for this vehicle, ignoring
                        // quarantined resources so a rejected batch cannot
                        // spin this loop.
                        val moreTelemetry = !telemetryQuarantined && telemetryDao.countUnsyncedForVehicle(vehicleId) > 0
                        val moreFuel = !fuelQuarantined && fuelDao.countUnsyncedForVehicle(vehicleId) > 0
                        val moreMaint = !maintQuarantined && maintDao.countUnsyncedForVehicle(vehicleId) > 0
                        vehicleHasMore = moreTelemetry || moreFuel || moreMaint
                    }
                }
            }

            OutboxDrainReport(
                hadSuccess = hadSuccess,
                hadNetworkFailures = hadNetworkFailures,
                hadIncompatibleServer = hadIncompatibleServer,
                blockedVehicles = blockedVehicles,
                quarantinedVehicles = quarantinedVehicles,
                quarantinedCount = quarantinedCount,
                totalAckedTelemetry = ackedTelemetry,
                totalAckedFuel = ackedFuel,
                totalAckedMaint = ackedMaint
            )
        }
    }

    private data class BatchResult(val status: UploadBatchStatus, val ackedCount: Int)

    /**
     * Separates retryable transport/server failures from permanent
     * validation rejections so one bad batch cannot block other
     * vehicles. 401/403 keep their auth semantics; 429, 5xx and
     * transport exceptions are retryable with global backoff; every
     * other non-2xx (400 unknown vehicle, 404 missing resource, 422
     * semantic rejection, …) quarantines the batch while retaining
     * its rows.
     */
    private fun classifyHttpFailure(vehicleId: String, resource: String, statusCode: Int, body: String): BatchResult {
        if (statusCode == 429 || statusCode >= 500) {
            Log.w(TAG, "$resource upload retryable HTTP $statusCode for vehicle $vehicleId; backing off globally")
            return BatchResult(UploadBatchStatus.FAILED_NETWORK, 0)
        }
        Log.w(TAG, "$resource upload permanently rejected (HTTP $statusCode) for vehicle $vehicleId: $body; rows retained and quarantined")
        return BatchResult(UploadBatchStatus.FAILED_PERMANENT_VALIDATION, 0)
    }

    private suspend fun uploadTelemetryBatch(
        context: Context,
        db: AppDatabase,
        dao: TelemetryDao,
        vehicleId: String,
        batch: List<TelemetryEntity>
    ): BatchResult {
        val jsonArray = JSONArray()
        batch.forEach { record ->
            val jsonObj = JSONObject().apply {
                put("eventId", record.eventId)
                put("timestamp", record.timestamp)
                put("vehicleId", record.vehicleId)
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
                put("accOn", record.accOn ?: JSONObject.NULL)
                put("headlightOn", record.headlightOn ?: JSONObject.NULL)
                put("volume", record.volume ?: JSONObject.NULL)
                put("wifiSsid", record.wifiSsid ?: JSONObject.NULL)
                put("btConnected", record.btConnected ?: JSONObject.NULL)
            }
            jsonArray.put(jsonObj)
        }

        val url = "${getApiBaseUrl(context)}/api/telemetry/batch"
        val response = try {
            HttpTransport.postJson(url, jsonArray.toString(), context)
        } catch (e: Exception) {
            Log.e(TAG, "Telemetry upload network error: ${e.message}")
            return BatchResult(UploadBatchStatus.FAILED_NETWORK, 0)
        }

        if (response.statusCode == 403 || response.statusCode == 401) {
            Log.w(TAG, "Telemetry upload auth failure (${response.statusCode}) for vehicle $vehicleId: ${response.body}")
            return BatchResult(UploadBatchStatus.FAILED_VEHICLE_AUTH, 0)
        }

        if (!response.isSuccess) {
            return classifyHttpFailure(vehicleId, "Telemetry", response.statusCode, response.body)
        }

        // Process agreed contract
        val ackIds = parseAcknowledgedIds(context, response.body)
            ?: return BatchResult(UploadBatchStatus.INCOMPATIBLE_SERVER, 0)

        // Delete ONLY matching acknowledged local IDs transactionally
        val matchingIds = batch.map { it.eventId }.filter { ackIds.contains(it) }
        if (matchingIds.isNotEmpty()) {
            db.withTransaction {
                dao.deleteByEventIds(matchingIds)
            }
        }

        // Check for server commands in response
        handleCommandsInResponse(response.body)

        return BatchResult(UploadBatchStatus.SUCCESS_ACKNOWLEDGED, matchingIds.size)
    }

    private suspend fun uploadFuelBatch(
        context: Context,
        db: AppDatabase,
        dao: FuelLogDao,
        vehicleId: String,
        batch: List<FuelLogEntity>
    ): BatchResult {
        val jsonArray = JSONArray()
        batch.forEach { log ->
            val jsonObj = JSONObject().apply {
                put("eventId", log.eventId)
                put("id", log.id)
                put("vehicleId", log.vehicleId)
                put("timestamp", log.timestamp)
                put("litres", log.litres)
                put("odometer", log.odometer)
                put("source", "app")
            }
            jsonArray.put(jsonObj)
        }

        val url = "${getApiBaseUrl(context)}/api/fuel-logs"
        val response = try {
            HttpTransport.postJson(url, jsonArray.toString(), context)
        } catch (e: Exception) {
            Log.e(TAG, "Fuel upload network error: ${e.message}")
            return BatchResult(UploadBatchStatus.FAILED_NETWORK, 0)
        }

        if (response.statusCode == 403 || response.statusCode == 401) {
            Log.w(TAG, "Fuel upload auth failure (${response.statusCode}) for vehicle $vehicleId: ${response.body}")
            return BatchResult(UploadBatchStatus.FAILED_VEHICLE_AUTH, 0)
        }

        if (!response.isSuccess) {
            return classifyHttpFailure(vehicleId, "Fuel", response.statusCode, response.body)
        }

        val ackIds = parseAcknowledgedIds(context, response.body)
            ?: return BatchResult(UploadBatchStatus.INCOMPATIBLE_SERVER, 0)

        val matchingIds = batch.map { it.eventId }.filter { ackIds.contains(it) }
        if (matchingIds.isNotEmpty()) {
            db.withTransaction {
                dao.deleteByEventIds(matchingIds)
            }
        }

        return BatchResult(UploadBatchStatus.SUCCESS_ACKNOWLEDGED, matchingIds.size)
    }

    private suspend fun uploadMaintenanceBatch(
        context: Context,
        db: AppDatabase,
        dao: MaintenanceDao,
        vehicleId: String,
        batch: List<MaintenanceEntity>
    ): BatchResult {
        val jsonArray = JSONArray()
        batch.forEach { item ->
            val jsonObj = JSONObject().apply {
                put("eventId", item.eventId)
                put("id", item.serverId)
                put("vehicleId", item.vehicleId)
                put("name", item.name)
                put("intervalKm", item.intervalKm ?: JSONObject.NULL)
                put("intervalDays", item.intervalDays ?: JSONObject.NULL)
                put("lastServiceOdo", item.lastServiceOdo ?: JSONObject.NULL)
                put("lastServiceDate", item.lastServiceDate ?: JSONObject.NULL)
                put("notes", item.notes)
            }
            jsonArray.put(jsonObj)
        }

        val url = "${getApiBaseUrl(context)}/api/maintenance"
        val response = try {
            HttpTransport.postJson(url, jsonArray.toString(), context)
        } catch (e: Exception) {
            Log.e(TAG, "Maintenance upload network error: ${e.message}")
            return BatchResult(UploadBatchStatus.FAILED_NETWORK, 0)
        }

        if (response.statusCode == 403 || response.statusCode == 401) {
            Log.w(TAG, "Maintenance upload auth failure (${response.statusCode}) for vehicle $vehicleId: ${response.body}")
            return BatchResult(UploadBatchStatus.FAILED_VEHICLE_AUTH, 0)
        }

        if (!response.isSuccess) {
            return classifyHttpFailure(vehicleId, "Maintenance", response.statusCode, response.body)
        }

        val ackIds = parseAcknowledgedIds(context, response.body)
            ?: return BatchResult(UploadBatchStatus.INCOMPATIBLE_SERVER, 0)

        val matchingIds = batch.map { it.eventId }.filter { ackIds.contains(it) }
        if (matchingIds.isNotEmpty()) {
            db.withTransaction {
                dao.deleteByEventIds(matchingIds)
            }
        }

        return BatchResult(UploadBatchStatus.SUCCESS_ACKNOWLEDGED, matchingIds.size)
    }

    /**
     * Parses agreed contract:
     * Server returns {success:true, acceptedIds:[...], duplicateIds:[...]}
     * Returns set of all acknowledged event IDs (accepted + duplicate).
     * If 2xx response does NOT have acceptedIds or duplicateIds, returns null to signal incompatibility.
     */
    fun parseAcknowledgedIds(context: Context, responseBody: String): Set<String>? {
        if (responseBody.isBlank()) {
            surfaceIncompatibility(context, "Server returned empty 2xx body without event ID acknowledgments")
            return null
        }
        try {
            val json = JSONObject(responseBody)
            val hasAccepted = json.has("acceptedIds")
            val hasDuplicate = json.has("duplicateIds")

            if (!hasAccepted && !hasDuplicate) {
                surfaceIncompatibility(
                    context,
                    "Server returned 2xx without acceptedIds/duplicateIds arrays. Queue retained to prevent data loss."
                )
                return null
            }

            val ackSet = mutableSetOf<String>()
            if (hasAccepted) {
                val acceptedArr = json.optJSONArray("acceptedIds")
                if (acceptedArr != null) {
                    for (i in 0 until acceptedArr.length()) {
                        val id = acceptedArr.optString(i)
                        if (id.isNotEmpty()) ackSet.add(id)
                    }
                }
            }
            if (hasDuplicate) {
                val dupArr = json.optJSONArray("duplicateIds")
                if (dupArr != null) {
                    for (i in 0 until dupArr.length()) {
                        val id = dupArr.optString(i)
                        if (id.isNotEmpty()) ackSet.add(id)
                    }
                }
            }
            return ackSet
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse JSON response for acknowledged event IDs: ${e.message}")
            surfaceIncompatibility(context, "Invalid JSON from server; queue retained.")
            return null
        }
    }

    private fun surfaceIncompatibility(context: Context, message: String) {
        Log.w(TAG, "Server Incompatibility Detected: $message")
        try {
            val intent = Intent(ACTION_INCOMPATIBILITY).apply {
                setPackage(context.packageName)
                putExtra(EXTRA_MESSAGE, message)
            }
            context.sendBroadcast(intent)
        } catch (_: Exception) { }
    }

    private fun handleCommandsInResponse(responseBody: String) {
        try {
            val json = JSONObject(responseBody)
            if (json.has("commands")) {
                val commandsArray = json.getJSONArray("commands")
                for (i in 0 until commandsArray.length()) {
                    val cmd = commandsArray.optJSONObject(i)?.optString("command")
                        ?: commandsArray.optString(i)
                    if (cmd.isNotEmpty()) {
                        commandHandler?.invoke(cmd)
                    }
                }
            }
        } catch (_: Exception) { }
    }
}
