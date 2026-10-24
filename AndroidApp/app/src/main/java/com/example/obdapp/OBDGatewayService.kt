package com.example.obdapp

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.github.eltonvs.obd.command.ObdCommand
import com.github.eltonvs.obd.command.ObdRawResponse
import com.github.eltonvs.obd.command.NoDataException
import com.github.eltonvs.obd.command.UnSupportedCommandException
import com.github.eltonvs.obd.command.engine.RPMCommand
import com.github.eltonvs.obd.command.engine.SpeedCommand
import com.github.eltonvs.obd.connection.ObdDeviceConnection
import android.util.Log
import java.util.Locale
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.IOException
import java.io.OutputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

// Define custom commands for parameters not built into eltonvs:kotlin-obd-api or to ensure compatibility
class CoolantTemperatureCommand : ObdCommand() {
    override val tag = "COOLANT_TEMPERATURE"
    override val name = "Coolant Temperature"
    override val mode = "01"
    override val pid = "05"
    override val defaultUnit = "°C"
    override val handler = { response: ObdRawResponse ->
        (obdPidPayload(response, 0x05, 1)[0] - 40).toString()
    }
}

class LoadCommand : ObdCommand() {
    override val tag = "ENGINE_LOAD"
    override val name = "Engine Load"
    override val mode = "01"
    override val pid = "04"
    override val defaultUnit = "%"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x04, 1)
        if (raw.isNotEmpty()) {
            val value = raw[0] and 0xFF
            (value * 100 / 255).toString()
        } else "0"
    }
}

class ThrottlePositionCommand : ObdCommand() {
    override val tag = "THROTTLE_POSITION"
    override val name = "Throttle Position"
    override val mode = "01"
    override val pid = "11"
    override val defaultUnit = "%"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x11, 1)
        if (raw.isNotEmpty()) {
            val value = raw[0] and 0xFF
            (value * 100 / 255).toString()
        } else "0"
    }
}

class FuelLevelCommand : ObdCommand() {
    override val tag = "FUEL_LEVEL"
    override val name = "Fuel Level"
    override val mode = "01"
    override val pid = "2F"
    override val defaultUnit = "%"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x2F, 1)
        if (raw.isNotEmpty()) {
            val value = raw[0] and 0xFF
            (value * 100 / 255).toString()
        } else "0"
    }
}

class ModuleVoltageCommand : ObdCommand() {
    override val tag = "MODULE_VOLTAGE"
    override val name = "Control Module Voltage"
    override val mode = "01"
    override val pid = "42"
    override val defaultUnit = "V"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x42, 2)
        if (raw.size >= 2) {
            val a = raw[0] and 0xFF
            val b = raw[1] and 0xFF
            (((a * 256) + b) / 1000.0).toString()
        } else "0.0"
    }
}

class AmbientAirTempCommand : ObdCommand() {
    override val tag = "AMBIENT_AIR_TEMP"
    override val name = "Ambient Air Temperature"
    override val mode = "01"
    override val pid = "46"
    override val defaultUnit = "°C"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x46, 1)
        if (raw.isNotEmpty()) {
            val value = raw[0] and 0xFF
            (value - 40).toString()
        } else "0"
    }
}

class MassAirFlowCommand : ObdCommand() {
    override val tag = "MASS_AIR_FLOW"
    override val name = "Mass Air Flow"
    override val mode = "01"
    override val pid = "10"
    override val defaultUnit = "g/s"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x10, 2)
        ((raw[0] * 256 + raw[1]) / 100.0).toString()
    }
}

class FuelSystemStatusCommand : ObdCommand() {
    var secondarySystemStatus: Int? = null
        private set
    override val tag = "FUEL_SYSTEM_STATUS"
    override val name = "Fuel System Status"
    override val mode = "01"
    override val pid = "03"
    override val defaultUnit = ""
    override val handler = { response: ObdRawResponse ->
        // A second active fuel system may have a different mixture. Do not
        // calculate from bank 1 alone unless bank 2 is absent or closed-loop.
        val raw = obdPidPayload(response, 0x03, 2)
        secondarySystemStatus = raw[1]
        raw[0].toString()
    }
}

class ResetTroubleCodesCommand : ObdCommand() {
    override val tag = "RESET_DTC"
    override val name = "Reset Trouble Codes"
    override val mode = "04"
    override val pid = ""
    override val defaultUnit = ""
    override val handler = { response: ObdRawResponse ->
        response.value
    }
}

class IntakeAirTemperatureCommand : ObdCommand() {
    override val tag = "INTAKE_AIR_TEMP"
    override val name = "Intake Air Temperature"
    override val mode = "01"
    override val pid = "0F"
    override val defaultUnit = "°C"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x0F, 1)
        if (raw.isNotEmpty()) {
            val value = raw[0] and 0xFF
            (value - 40).toString()
        } else "0"
    }
}

class ManifoldAbsolutePressureCommand : ObdCommand() {
    override val tag = "INTAKE_MANIFOLD_PRESSURE"
    override val name = "Intake Manifold Absolute Pressure"
    override val mode = "01"
    override val pid = "0B"
    override val defaultUnit = "kPa"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x0B, 1)
        if (raw.isNotEmpty()) {
            (raw[0] and 0xFF).toString()
        } else "0"
    }
}

class RelativeThrottlePositionCommand : ObdCommand() {
    override val tag = "RELATIVE_THROTTLE_POSITION"
    override val name = "Relative Throttle Position"
    override val mode = "01"
    override val pid = "45"
    override val defaultUnit = "%"
    override val handler = { response: ObdRawResponse ->
        val raw = obdPidPayload(response, 0x45, 1)
        if (raw.isNotEmpty()) {
            val value = raw[0] and 0xFF
            (value * 100 / 255).toString()
        } else "0"
    }
}

class OBDGatewayService : Service(), LocationListener {

    companion object {
        private const val TAG = "OBDGatewayService"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private val serviceJob = Job()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    private var bluetoothSocket: BluetoothSocket? = null
    @Volatile private var obdConnection: ObdDeviceConnection? = null
    private val obdMutex = Mutex()
    private val commandMutex = Mutex()
    private var commandRecoveryJob: Job? = null

    // Owned singleton lifecycle jobs
    private var connectionJob: Job? = null
    private var collectorJob: Job? = null
    private var syncJob: Job? = null
    private val syncWakeupChannel = Channel<Unit>(Channel.CONFLATED)

    private val persistencePolicy = TelemetryPersistencePolicy()

    @Volatile private var obdCapabilities: ObdCapabilities = ObdCapabilities.EMPTY

    // Slow PID cache and timestamps
    @Volatile private var cachedCoolantTemp: Int? = null
    @Volatile private var cachedCoolantTimestamp: Long = 0L

    @Volatile private var cachedFuelLevel: Int? = null
    @Volatile private var cachedFuelLevelTimestamp: Long = 0L

    @Volatile private var cachedAmbientTemp: Int? = null
    @Volatile private var cachedAmbientTimestamp: Long = 0L

    @Volatile private var cachedModuleVoltage: Float? = null
    @Volatile private var cachedModuleVoltageTimestamp: Long = 0L

    @Volatile private var cachedIntakeAirTemp: Int? = null
    @Volatile private var cachedIntakeAirTimestamp: Long = 0L

    @Volatile private var cachedManifoldPressure: Int? = null
    @Volatile private var cachedManifoldPressureTimestamp: Long = 0L

    private var slowPidIndex = 0
    private val slowPidRetryAfter = LongArray(6)
    @Volatile private var cachedEngineLoad: Int? = null
    @Volatile private var cachedThrottlePos: Int? = null
    private var lastSecondaryPidReadElapsed: Long = 0L
    private var throttleRetryAfterElapsed: Long = 0L
    private var fuelEstimateRetryAfterElapsed: Long = 0L

    private val COOLANT_REFRESH_MS = 15_000L
    private val VOLTAGE_REFRESH_MS = 20_000L
    private val FUEL_REFRESH_MS = 60_000L
    private val AMBIENT_REFRESH_MS = 60_000L
    private val INTAKE_AIR_REFRESH_MS = 20_000L
    private val MANIFOLD_PRESSURE_REFRESH_MS = 15_000L

    @Volatile private var cachedFallbackWifiSsid: String? = null
    @Volatile private var lastFallbackWifiSsidTimestamp: Long = 0L
    private val FALLBACK_WIFI_SSID_REFRESH_MS = 60_000L

    // Location fields
    private var locationManager: LocationManager? = null
    private val gpsTelemetry = GpsTelemetryPolicy()
    @Volatile private var lastGpsRegistrationElapsed: Long = 0L
    @Volatile private var lastLocationProvider: String? = null

    // 0-100 km/h acceleration tracking engine
    private val accelTracker = AccelerationTracker { timeSec ->
        triggerLocalAlertNotification("0-100 km/h Sprint Completed", "Time: ${timeSec}s")
    }

    private fun processSpeedUpdate(speedKmh: Float, timestampMs: Long) {
        accelTracker.processSpeed(speedKmh, timestampMs)
    }

    // Standard SPP UUID for ELM327
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private var deviceMacAddress: String? = null
    private var foregroundReady = false
    private var stopStatus = "Service Stopped"

    private fun getSelectedObdMac(): String? {
        return VehiclePrefs.getActiveAdapterMac(this)
    }

    override fun onCreate() {
        super.onCreate()
        if (applicationInfo.targetSdkVersion >= 31 && !GatewayPermissions.granted(this)) {
            rejectStartup("Permissions denied — check Bluetooth and location permissions")
            return
        }
        try {
            createNotificationChannel()
            startForeground(1, buildNotification("Initializing OBD Service..."))
        } catch (error: SecurityException) {
            Log.w(TAG, "Foreground collection permission changed during startup", error)
            rejectStartup("Permissions denied — check Bluetooth and location permissions")
            return
        } catch (error: IllegalStateException) {
            Log.w(TAG, "Foreground collection start is no longer allowed", error)
            rejectStartup("Collection stopped — open the phone app and press Start")
            return
        }
        foregroundReady = true
        isRunning = true
        GatewayStatusStore.setRunning(true)
        setupGPS()

        // Register Outbox connectivity callback for immediate drain wakeups
        OutboxUploader.registerConnectivityCallback(applicationContext) {
            triggerSyncWakeup()
        }
        commandRecoveryJob = serviceScope.launch {
            val dao = AppDatabase.getDatabase(applicationContext).commandInboxDao()
            val now = System.currentTimeMillis()
            dao.recoverInterruptedReads(now)
            val interruptedClears = dao.markInterruptedClearsUnknown(now)
            if (interruptedClears > 0) {
                triggerLocalAlertNotification(
                    "DTC Clear Outcome Unknown",
                    "The app stopped during a clear attempt. Check the vehicle before retrying."
                )
            }
        }
        OutboxUploader.commandHandler = {
            processPendingCommands()
        }
    }

    private fun setupGPS() {
        lastGpsRegistrationElapsed = SystemClock.elapsedRealtime()
        try {
            locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                val manager = locationManager ?: return
                manager.removeUpdates(this)
                for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                    if (!manager.allProviders.contains(provider)) continue
                    // Time-based updates also reach the app when stationary.
                    manager.requestLocationUpdates(provider, 1000L, 0.0f, this, Looper.getMainLooper())
                }
                listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
                    .filter { manager.allProviders.contains(it) }
                    .mapNotNull { manager.getLastKnownLocation(it) }
                    .sortedByDescending { it.elapsedRealtimeNanos }
                    .forEach { onLocationChanged(it) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Unable to subscribe to location updates", e)
        }
    }

    private fun rejectStartup(message: String) {
        foregroundReady = false
        isRunning = false
        GatewayStatusStore.setRunning(false)
        stopStatus = message
        stopSelf()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A queued start callback can arrive after onCreate rejected promotion.
        if (!foregroundReady) return START_NOT_STICKY
        if (applicationInfo.targetSdkVersion >= 31 && !GatewayPermissions.granted(this)) {
            rejectStartup("Permissions denied — check Bluetooth and location permissions")
            return START_NOT_STICKY
        }
        isRunning = true
        startObdPolling()
        startTelemetrySync()
        updateNotification("OBD: Service Running")
        return START_STICKY
    }

    private fun isNetworkAvailable(): Boolean {
        return OutboxUploader.isNetworkAvailable(this)
    }

    fun triggerSyncWakeup() {
        syncWakeupChannel.trySend(Unit)
    }

    private suspend fun waitForNextSync(timeoutMs: Long) {
        withTimeoutOrNull(timeoutMs) {
            syncWakeupChannel.receive()
        }
    }

    @Synchronized
    private fun startTelemetrySync() {
        if (syncJob?.isActive == true) return
        syncJob = serviceScope.launch {
            var syncDelay = 60_000L
            val maxSyncDelay = 3600_000L

            while (isActive) {
                var hadFailures = false
                var hadSuccess = false
                try {
                    if (!isDeviceConfigured(applicationContext)) {
                        GatewayStatusStore.recordSync(VehiclePrefs.getActiveVehicleId(this@OBDGatewayService),
                            GatewaySyncState.SETUP_REQUIRED, SystemClock.elapsedRealtime())
                        updateNotification("OBD: Car not paired — scan QR in app to pair")
                        waitForNextSync(syncDelay)
                        continue
                    }

                    if (isNetworkAvailable()) {
                        val report = OutboxUploader.drainOutbox(applicationContext)
                        hadSuccess = report.hadSuccess
                        hadFailures = report.hadNetworkFailures
                    } else {
                        GatewayStatusStore.recordSync(VehiclePrefs.getActiveVehicleId(this@OBDGatewayService),
                            GatewaySyncState.OFFLINE, SystemClock.elapsedRealtime())
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Telemetry sync error: ${e.message}", e)
                    hadFailures = true
                    GatewayStatusStore.recordSync(VehiclePrefs.getActiveVehicleId(this@OBDGatewayService),
                        GatewaySyncState.ERROR, SystemClock.elapsedRealtime())
                }

                if (hadFailures && !hadSuccess) {
                    syncDelay = (syncDelay * 2).coerceAtMost(maxSyncDelay)
                } else if (hadSuccess) {
                    syncDelay = 60_000L
                }

                waitForNextSync(syncDelay)
            }
        }
    }

    private fun processPendingCommands() {
        serviceScope.launch {
            commandRecoveryJob?.join()
            commandMutex.withLock {
                val vehicleId = VehiclePrefs.getActiveVehicleId(this@OBDGatewayService)
                val dao = AppDatabase.getDatabase(applicationContext).commandInboxDao()
                for (command in dao.getReady(vehicleId)) {
                    // Never claim a command while the adapter is disconnected:
                    // the same durable inbox row will be revisited after reconnect.
                    if (obdConnection == null) return@withLock
                    val now = System.currentTimeMillis()
                    if (command.expiresAt != null && command.expiresAt <= now) {
                        dao.markExpired(command.id, now)
                        continue
                    }
                    if (dao.claim(command.id, now) != 1) {
                        dao.markExpired(command.id, System.currentTimeMillis())
                        continue
                    }

                    var status: String
                    var result: JSONObject
                    try {
                        when (command.command) {
                            "read_dtc" -> {
                                val raw = obdMutex.withLock {
                                    checkNotNull(obdConnection) { "OBD adapter disconnected" }
                                        .run(com.github.eltonvs.obd.command.control.TroubleCodesCommand())
                                        ?.formattedValue ?: ""
                                }
                                status = "completed"
                                result = JSONObject().put("dtc", raw)
                                if (!command.requiresAck) uploadDtcResult(raw)
                            }
                            "clear_dtc" -> {
                                obdMutex.withLock {
                                    checkNotNull(obdConnection) { "OBD adapter disconnected" }
                                        .run(ResetTroubleCodesCommand())
                                }
                                status = "completed"
                                result = JSONObject().put("success", true)
                                if (!command.requiresAck) uploadDtcClearStatus(true)
                            }
                            else -> {
                                status = "failed"
                                result = JSONObject().put("error", "Unsupported command")
                            }
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Command ${command.id} (${command.command}) failed: ${e.message}", e)
                        if (command.command == "clear_dtc") {
                            // The adapter may have received mode 04 before the
                            // connection failed. Never replay this physical action.
                            status = "unknown"
                            result = JSONObject().put("reason", e.message ?: "Adapter outcome is uncertain")
                            triggerLocalAlertNotification(
                                "DTC Clear Outcome Unknown",
                                "Check the vehicle before retrying; codes may already be cleared."
                            )
                            if (!command.requiresAck) uploadDtcClearStatus(false)
                        } else {
                            status = "failed"
                            result = JSONObject().put("error", e.message ?: "OBD read failed")
                            if (!command.requiresAck) uploadDtcResult("Error: ${e.message}")
                        }
                    }

                    val saved = dao.saveResult(command.id, result.toString(), status, System.currentTimeMillis())
                    if (saved == 1 && !command.requiresAck) {
                        dao.markAcked(command.id, System.currentTimeMillis())
                    }
                }
            }
        }
    }

    private fun uploadDtcResult(dtcRaw: String) {
        val serverUrl = getApiBaseUrl(this)
        val dtcUrl = "$serverUrl/api/telemetry/dtc"
        serviceScope.launch {
            try {
                val payload = JSONObject().apply {
                    put("dtc", dtcRaw)
                    put("vehicleId", VehiclePrefs.getActiveVehicleId(this@OBDGatewayService))
                    put("timestamp", System.currentTimeMillis())
                }
                HttpTransport.postJson(dtcUrl, payload.toString(), this@OBDGatewayService)
            } catch (e: Exception) {
                Log.e(TAG, "uploadDtcResult error: ${e.message}", e)
            }
        }
    }

    private fun uploadDtcClearStatus(success: Boolean) {
        val serverUrl = getApiBaseUrl(this)
        val dtcUrl = "$serverUrl/api/telemetry/dtc/clear"
        serviceScope.launch {
            try {
                val payload = JSONObject().apply {
                    put("success", success)
                    put("vehicleId", VehiclePrefs.getActiveVehicleId(this@OBDGatewayService))
                    put("timestamp", System.currentTimeMillis())
                }
                HttpTransport.postJson(dtcUrl, payload.toString(), this@OBDGatewayService)
            } catch (e: Exception) {
                Log.e(TAG, "uploadDtcClearStatus error: ${e.message}", e)
            }
        }
    }

    private fun triggerLocalAlertNotification(title: String, content: String) {
        if (!GatewayPermissions.canPostNotifications(this)) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val alertNotification = NotificationCompat.Builder(this, "OBD_CHANNEL")
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        manager.notify(System.currentTimeMillis().toInt(), alertNotification)
    }

    private fun startObdPolling() {
        startConnectionJob()
        startCollectorJob()
    }

    @Synchronized
    private fun startConnectionJob() {
        if (connectionJob?.isActive == true) return
        connectionJob = serviceScope.launch {
            var reconnectDelay = 5000L
            val maxReconnectDelay = 60000L
            while (isActive) {
                if (!isAccOn()) {
                    if (obdConnection != null) {
                        obdConnection = null
                        try {
                            bluetoothSocket?.close()
                        } catch (_: Exception) {}
                        bluetoothSocket = null
                    }
                    updateNotification("OBD: Suspended (Car Off)")
                    delay(5000)
                    continue
                }
                if (obdConnection == null) {
                    val selectedMac = getSelectedObdMac()
                    if (selectedMac == null) {
                        updateNotification("OBD: GPS Only (Select OBD adapter in app)")
                        delay(30000)
                        reconnectDelay = 5000L
                        continue
                    }

                    updateNotification("OBD: GPS Only (Connecting BT...)")
                    try {
                        obdMutex.withLock {
                            val connection = connectBluetooth()
                            val capabilities = initializeObdAdapter(connection)
                            obdCapabilities = capabilities
                            slowPidRetryAfter.fill(0L)
                            cachedEngineLoad = null
                            cachedThrottlePos = null
                            cachedIntakeAirTemp = null
                            cachedManifoldPressure = null
                            lastSecondaryPidReadElapsed = 0L
                            throttleRetryAfterElapsed = 0L
                            fuelEstimateRetryAfterElapsed = 0L
                            // Publish only after initialization so the collector
                            // cannot query PIDs during adapter reset/setup.
                            obdConnection = connection
                        }
                        Log.i(TAG, "OBD adapter initialized successfully (${obdCapabilities.supportedPids.size} supported PIDs)")
                        val matchedVehicle = VehiclePrefs.findVehicleByMac(this@OBDGatewayService, selectedMac)
                        if (matchedVehicle != null && matchedVehicle.id != VehiclePrefs.getActiveVehicleId(this@OBDGatewayService)) {
                            VehiclePrefs.setActiveVehicle(this@OBDGatewayService, matchedVehicle.id)
                        }
                        val activeName = VehiclePrefs.getActiveVehicle(this@OBDGatewayService).name
                        updateNotification("OBD Connected ($activeName)")
                        processPendingCommands()
                        reconnectDelay = 5000L
                    } catch (e: Exception) {
                        if (e is CancellationException) throw e
                        e.printStackTrace()
                        updateNotification("OBD: GPS Only Mode")
                        handleObdDisconnect()
                        delay(reconnectDelay)
                        reconnectDelay = (reconnectDelay * 2).coerceAtMost(maxReconnectDelay)
                    }
                } else {
                    // Already connected — check again in 10s
                    delay(10000)
                }
            }
        }
    }

    private suspend fun pollStaggeredSlowPid() {
        val now = System.currentTimeMillis()
        val slowPidCandidates = 6
        for (step in 0 until slowPidCandidates) {
            val candidate = (slowPidIndex + step) % slowPidCandidates
            val isSupported = when (candidate) {
                0 -> !obdCapabilities.hasCapabilities() || obdCapabilities.isSupported(0x05)
                1 -> !obdCapabilities.hasCapabilities() || obdCapabilities.isSupported(0x42)
                2 -> !obdCapabilities.hasCapabilities() || obdCapabilities.isSupported(0x2F)
                3 -> !obdCapabilities.hasCapabilities() || obdCapabilities.isSupported(0x46)
                4 -> !obdCapabilities.hasCapabilities() || obdCapabilities.isSupported(0x0F)
                5 -> !obdCapabilities.hasCapabilities() || obdCapabilities.isSupported(0x0B)
                else -> false
            }
            if (!isSupported) continue

            val shouldPoll = when (candidate) {
                0 -> (now - cachedCoolantTimestamp) >= COOLANT_REFRESH_MS
                1 -> (now - cachedModuleVoltageTimestamp) >= VOLTAGE_REFRESH_MS
                2 -> (now - cachedFuelLevelTimestamp) >= FUEL_REFRESH_MS
                3 -> (now - cachedAmbientTimestamp) >= AMBIENT_REFRESH_MS
                4 -> (now - cachedIntakeAirTimestamp) >= INTAKE_AIR_REFRESH_MS
                5 -> (now - cachedManifoldPressureTimestamp) >= MANIFOLD_PRESSURE_REFRESH_MS
                else -> false
            }
            if (shouldPoll && now >= slowPidRetryAfter[candidate]) {
                slowPidIndex = (candidate + 1) % slowPidCandidates
                try {
                    obdMutex.withLock {
                        if (obdConnection == null) return@withLock
                        when (candidate) {
                            0 -> {
                                val resp = obdConnection?.run(CoolantTemperatureCommand())
                                delay(100)
                                val v = resp?.value?.toIntOrNull()
                                if (v != null) {
                                    cachedCoolantTemp = v
                                    cachedCoolantTimestamp = System.currentTimeMillis()
                                }
                            }
                            1 -> {
                                val resp = obdConnection?.run(ModuleVoltageCommand())
                                delay(100)
                                val v = resp?.value?.toFloatOrNull()
                                if (v != null) {
                                    cachedModuleVoltage = v
                                    cachedModuleVoltageTimestamp = System.currentTimeMillis()
                                }
                            }
                            2 -> {
                                val resp = obdConnection?.run(FuelLevelCommand())
                                delay(100)
                                val v = resp?.value?.toIntOrNull()
                                if (v != null) {
                                    cachedFuelLevel = v
                                    cachedFuelLevelTimestamp = System.currentTimeMillis()
                                }
                            }
                            3 -> {
                                val resp = obdConnection?.run(AmbientAirTempCommand())
                                delay(100)
                                val v = resp?.value?.toIntOrNull()
                                if (v != null) {
                                    cachedAmbientTemp = v
                                    cachedAmbientTimestamp = System.currentTimeMillis()
                                }
                            }
                            4 -> {
                                val resp = obdConnection?.run(IntakeAirTemperatureCommand())
                                delay(100)
                                val v = resp?.value?.toIntOrNull()
                                if (v != null) {
                                    cachedIntakeAirTemp = v
                                    cachedIntakeAirTimestamp = System.currentTimeMillis()
                                }
                            }
                            5 -> {
                                val resp = obdConnection?.run(ManifoldAbsolutePressureCommand())
                                delay(100)
                                val v = resp?.value?.toIntOrNull()
                                if (v != null) {
                                    cachedManifoldPressure = v
                                    cachedManifoldPressureTimestamp = System.currentTimeMillis()
                                }
                            }
                        }
                    }
                } catch (noData: NoDataException) {
                    postponeUnavailableSlowPid(candidate)
                } catch (unsupported: UnSupportedCommandException) {
                    postponeUnavailableSlowPid(candidate)
                }
                break // Only poll at most ONE slow PID per cycle to preserve adapter fairness
            }
        }
    }

    private fun postponeUnavailableSlowPid(candidate: Int) {
        slowPidRetryAfter[candidate] = System.currentTimeMillis() + 5 * 60 * 1000L
        when (candidate) {
            0 -> cachedCoolantTemp = null
            1 -> cachedModuleVoltage = null
            2 -> cachedFuelLevel = null
            3 -> cachedAmbientTemp = null
            4 -> cachedIntakeAirTemp = null
            5 -> cachedManifoldPressure = null
        }
        Log.i(TAG, "Optional OBD sensor $candidate unavailable; retrying in five minutes")
    }

    private fun handleObdDisconnect() {
        obdConnection = null
        obdCapabilities = ObdCapabilities.EMPTY
        cachedEngineLoad = null
        cachedThrottlePos = null
        cachedIntakeAirTemp = null
        cachedManifoldPressure = null
        lastSecondaryPidReadElapsed = 0L
        throttleRetryAfterElapsed = 0L
        fuelEstimateRetryAfterElapsed = 0L
        try {
            bluetoothSocket?.close()
        } catch (_: Exception) {}
        bluetoothSocket = null
        updateNotification("OBD: Connection Lost — GPS Only")
    }

    @Synchronized
    private fun startCollectorJob() {
        if (collectorJob?.isActive == true) return
        persistencePolicy.reset()
        collectorJob = serviceScope.launch {
            val db = AppDatabase.getDatabase(applicationContext)
            val dao = db.telemetryDao()

            while (isActive) {
                val cycleStartedElapsed = SystemClock.elapsedRealtime()
                try {
                    if (!isAccOn()) {
                        delay(5000)
                        continue
                    }
                    var rpm: Int? = null
                    var speed: Int? = null
                    var engineLoad: Int? = cachedEngineLoad
                    var throttlePos: Int? = cachedThrottlePos
                    // Fuel inputs belong to this cycle; never reuse old values.
                    var mafGps: Double? = null
                    var fuelSystemStatus: Int? = null
                    var secondaryFuelSystemEligible = false

                    // Fast OBD readings: short locked window with delay between commands
                    if (obdConnection != null) {
                        try {
                            obdMutex.withLock {
                                if (obdConnection != null) {
                                    val rpmResp = obdConnection?.run(RPMCommand())
                                    delay(ObdPollingCadence.COMMAND_GAP_MS)
                                    val speedResp = obdConnection?.run(SpeedCommand())
                                    delay(ObdPollingCadence.COMMAND_GAP_MS)

                                    rpm = rpmResp?.value?.toIntOrNull()
                                    speed = speedResp?.value?.toIntOrNull()
                                    val nowElapsed = SystemClock.elapsedRealtime()
                                    if (nowElapsed >= fuelEstimateRetryAfterElapsed) {
                                        try {
                                            mafGps = obdConnection?.run(MassAirFlowCommand())?.value?.toDoubleOrNull()
                                            delay(ObdPollingCadence.COMMAND_GAP_MS)
                                            val fuelStatusCommand = FuelSystemStatusCommand()
                                            fuelSystemStatus = obdConnection?.run(fuelStatusCommand)?.value?.toIntOrNull()
                                            secondaryFuelSystemEligible = fuelStatusCommand.secondarySystemStatus in listOf(0, 2)
                                            delay(ObdPollingCadence.COMMAND_GAP_MS)
                                        } catch (e: Exception) {
                                            if (e is NoDataException || e is UnSupportedCommandException) {
                                                mafGps = null
                                                fuelSystemStatus = null
                                                fuelEstimateRetryAfterElapsed = SystemClock.elapsedRealtime() + 5 * 60 * 1000L
                                                Log.i(TAG, "Fuel estimate inputs unavailable; retrying in five minutes")
                                            } else throw e
                                        }
                                    }
                                    // Read throttle on every fast cycle. Prefer relative throttle (PID 0x45)
                                    // when supported to report true pedal demand instead of absolute throttle.
                                    if (nowElapsed >= throttleRetryAfterElapsed) {
                                        try {
                                            val throttleCmd = if (obdCapabilities.isSupported(0x45)) {
                                                RelativeThrottlePositionCommand()
                                            } else {
                                                ThrottlePositionCommand()
                                            }
                                            cachedThrottlePos = obdConnection?.run(throttleCmd)?.value?.toIntOrNull()
                                            delay(ObdPollingCadence.COMMAND_GAP_MS)
                                        } catch (e: Exception) {
                                            if (e is NoDataException || e is UnSupportedCommandException) {
                                                cachedThrottlePos = null
                                                throttleRetryAfterElapsed = SystemClock.elapsedRealtime() + 5 * 60 * 1000L
                                                Log.i(TAG, "Throttle PID unavailable; retrying in five minutes")
                                            } else throw e
                                        }
                                    }
                                    if (nowElapsed - lastSecondaryPidReadElapsed >= ObdPollingCadence.SECONDARY_INTERVAL_MS) {
                                        val loadResp = obdConnection?.run(LoadCommand())
                                        delay(ObdPollingCadence.COMMAND_GAP_MS)
                                        cachedEngineLoad = loadResp?.value?.toIntOrNull()
                                        lastSecondaryPidReadElapsed = SystemClock.elapsedRealtime()
                                    }
                                    engineLoad = cachedEngineLoad
                                    throttlePos = cachedThrottlePos
                                }
                            }
                        } catch (obdEx: Exception) {
                            if (obdEx is CancellationException) throw obdEx
                            Log.w(TAG, "Fast OBD poll error", obdEx)
                            handleObdDisconnect()
                            rpm = null
                            speed = null
                            engineLoad = null
                            throttlePos = null
                        }
                    }

                    // Staggered slow PID polling: separate locked section, polling at most 1 slow PID per cycle
                    if (obdConnection != null) {
                        try {
                            pollStaggeredSlowPid()
                        } catch (obdEx: Exception) {
                            if (obdEx is CancellationException) throw obdEx
                            Log.w(TAG, "Slow OBD poll error", obdEx)
                            handleObdDisconnect()
                        }
                    }

                    val coolantTemp = cachedCoolantTemp
                    val fuelLevel = cachedFuelLevel
                    val ambientTemp = cachedAmbientTemp ?: cachedIntakeAirTemp
                    var voltage = cachedModuleVoltage ?: readSystemPropVoltage()

                    if (obdConnection == null) {
                        rpm = null
                        speed = null
                        engineLoad = null
                        throttlePos = null
                        mafGps = null
                        fuelSystemStatus = null
                    }

                    var gpsFix = gpsTelemetry.current(SystemClock.elapsedRealtimeNanos())
                    if (locationManager == null) {
                        // Subscribe once if not already initialized
                        withContext(Dispatchers.Main) { setupGPS() }
                        gpsFix = gpsTelemetry.current(SystemClock.elapsedRealtimeNanos())
                    }
                    val curSpeed = speed
                    // Only a fresh measured GPS speed takes precedence over OBD.
                    if (curSpeed != null && gpsFix?.speedKmh == null) {
                        processSpeedUpdate(curSpeed.toFloat(), System.currentTimeMillis())
                    }

                    // Harvest completed 0-100 sprint time (consumed once per run)
                    val completedAccelTime = accelTracker.harvestCompletedTime()

                    val isCoolantAlert = coolantTemp != null && coolantTemp > 105
                    val isVoltageAlert = voltage != null && voltage < 11.8f

                    if (isCoolantAlert) {
                        triggerLocalAlertNotification("Coolant Temperature Danger", "Engine Coolant is at $coolantTemp°C!")
                    }
                    if (isVoltageAlert) {
                        triggerLocalAlertNotification("Battery Voltage Warning", "System voltage is low: $voltage V")
                    }

                    val accOn = isAccOn()
                    val headlightOn = isHeadlightOn()
                    val volume = getSystemVolume()
                    val wifiSsid = getWifiSsid()
                    val btConnected = isBtConnected()

                    // Check freshness after GPS/system calls too: their latency
                    // must not turn old OBD inputs into a new fuel estimate.
                    val fuelEstimate = if (obdConnection != null) FuelConsumptionEstimate.calculate(
                        mafGps, speed, if (secondaryFuelSystemEligible) fuelSystemStatus else null,
                        SystemClock.elapsedRealtime() - cycleStartedElapsed, engineRpm = rpm
                    ) else null

                    val telemetry = TelemetryEntity(
                        timestamp = System.currentTimeMillis(),
                        vehicleId = VehiclePrefs.getActiveVehicleId(this@OBDGatewayService),
                        rpm = rpm,
                        speed = speed,
                        coolantTemp = coolantTemp,
                        // Existing storage/API use zero coordinates as no fix.
                        // Never attach an old position to a new telemetry time.
                        latitude = gpsFix?.latitude ?: 0.0,
                        longitude = gpsFix?.longitude ?: 0.0,
                        altitude = gpsFix?.altitudeMeters ?: 0.0,
                        gpsSpeed = gpsFix?.speedKmh ?: 0.0f,
                        engineLoad = engineLoad,
                        throttlePos = throttlePos,
                        fuelLevel = fuelLevel,
                        mafGps = mafGps,
                        fuelSystemStatus = fuelSystemStatus,
                        estimatedFuelRateLph = fuelEstimate?.litresPerHour,
                        estimatedFuelEconomyKmL = fuelEstimate?.kilometresPerLitre,
                        iat = cachedIntakeAirTemp,
                        map = cachedManifoldPressure,
                        ambientTemp = ambientTemp,
                        voltage = voltage,
                        accelTime = completedAccelTime,
                        alertCoolant = isCoolantAlert,
                        alertVoltage = isVoltageAlert,
                        accOn = accOn,
                        headlightOn = headlightOn,
                        volume = volume,
                        wifiSsid = wifiSsid,
                        btConnected = btConnected
                    )

                    // Local persistence is independent of networking or slow PID completion
                    persistencePolicy.persistIfEligible(telemetry, obdConnection != null, gpsFix != null) { sample ->
                        dao.insert(sample)
                    }

                    val effectiveSpeed = gpsFix?.speedKmh ?: speed?.toFloat()
                    val effectiveSpeedSource = if (gpsFix?.speedKmh != null) "GPS" else if (speed != null) "OBD" else ""
                    val gaugeSnapshot = LiveGaugeSnapshot(
                        speedKmh = effectiveSpeed,
                        speedSource = effectiveSpeedSource,
                        rpm = telemetry.rpm,
                        coolantTemp = telemetry.coolantTemp,
                        voltage = telemetry.voltage,
                        fuelRateLph = telemetry.estimatedFuelRateLph,
                        fuelEconomyKmL = telemetry.estimatedFuelEconomyKmL,
                        engineLoad = telemetry.engineLoad,
                        throttlePos = telemetry.throttlePos,
                        intakeAirTemp = cachedIntakeAirTemp,
                        manifoldPressureKpa = cachedManifoldPressure,
                        sampledAtElapsedMs = SystemClock.elapsedRealtime()
                    )
                    GatewayStatusStore.recordSample(
                        telemetry.vehicleId, obdConnection != null, gpsFix?.elapsedRealtimeNanos?.div(1_000_000L),
                        SystemClock.elapsedRealtime(), gaugeSnapshot
                    )

                    val updateIntent = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
                        setPackage(packageName)
                        putExtra("lat", telemetry.latitude)
                        putExtra("lon", telemetry.longitude)
                        putExtra("alt", telemetry.altitude)
                        putExtra("speed", gpsFix?.speedKmh ?: speed?.toFloat() ?: -1.0f)
                        putExtra("speed_source", if (gpsFix?.speedKmh != null) "GPS" else if (speed != null) "OBD" else "")
                        putExtra("gps_fix", gpsFix != null)
                        putExtra("gps_altitude_valid", gpsFix?.altitudeMeters != null)
                        putExtra("rpm", telemetry.rpm ?: -1)
                        putExtra("coolant", telemetry.coolantTemp ?: -1)
                        putExtra("throttle", telemetry.throttlePos ?: -1)
                        putExtra("load", telemetry.engineLoad ?: -1)
                        putExtra("maf", telemetry.mafGps ?: -1.0)
                        putExtra("fuel_status", telemetry.fuelSystemStatus ?: -1)
                        putExtra("iat", cachedIntakeAirTemp ?: -1)
                        putExtra("map", cachedManifoldPressure ?: -1)
                        putExtra("ambient", telemetry.ambientTemp ?: -1)
                        putExtra("estimated_fuel_economy_kml", telemetry.estimatedFuelEconomyKmL ?: -1.0)
                        putExtra("estimated_fuel_rate_lph", telemetry.estimatedFuelRateLph ?: -1.0)
                        putExtra("volt", telemetry.voltage ?: -1.0f)
                        putExtra("obd_status", if (obdConnection != null) "Connected" else "GPS Only")
                        putExtra("timestamp", telemetry.timestamp)
                        if (telemetry.accelTime != null) {
                            putExtra("accelTime", telemetry.accelTime)
                        }
                        putExtra("accOn", telemetry.accOn ?: false)
                        putExtra("headlightOn", telemetry.headlightOn ?: false)
                        putExtra("volume", telemetry.volume ?: -1)
                        putExtra("wifiSsid", telemetry.wifiSsid ?: "")
                        putExtra("btConnected", telemetry.btConnected ?: false)
                    }
                    sendBroadcast(updateIntent)

                    delay(ObdPollingCadence.pauseAfterCycle(
                        SystemClock.elapsedRealtime() - cycleStartedElapsed,
                        obdConnection != null
                    ))
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    e.printStackTrace()
                    delay(3000)
                }
            }
        }
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun connectBluetooth(): ObdDeviceConnection {
        // Startup requires both nearby-device permissions. Re-check on reconnect;
        // revocation exceptions from the socket/discovery calls reach the outer retry handler.
        if (applicationInfo.targetSdkVersion >= 31 && !GatewayPermissions.granted(this)) {
            throw SecurityException("Bluetooth/location permissions were revoked")
        }
        val mac = getSelectedObdMac()
        if (mac.isNullOrEmpty()) {
            throw Exception("No Bluetooth Device Selected")
        }
        deviceMacAddress = mac

        val adapter = BluetoothAdapter.getDefaultAdapter()
            ?: throw IOException("Bluetooth is unavailable")
        val device = adapter.getRemoteDevice(mac)
        // Discovery competes with RFCOMM connection setup, even when it was
        // started by another app.
        adapter.cancelDiscovery()
        bluetoothSocket = device.createRfcommSocketToServiceRecord(sppUuid)
        bluetoothSocket!!.connect()
        
        val inputStream: InputStream = bluetoothSocket!!.inputStream
        val outputStream: OutputStream = bluetoothSocket!!.outputStream
        
        return ObdDeviceConnection(inputStream, outputStream)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                "OBD_CHANNEL",
                "OBD Gateway Service Channel",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, "OBD_CHANNEL")
            .setContentTitle("OBD Gateway")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
    
    private fun updateNotification(text: String) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (GatewayPermissions.canPostNotifications(this)) {
            notificationManager.notify(1, buildNotification(text))
        }
        
        val statusIntent = Intent("com.example.obdapp.STATUS_UPDATE").apply {
            setPackage(packageName)
            putExtra("status", text)
            putExtra("running", true)
        }
        sendBroadcast(statusIntent)
    }

    override fun onLocationChanged(location: Location) {
        val nowElapsed = SystemClock.elapsedRealtimeNanos()
        val current = gpsTelemetry.current(nowElapsed)
        if (location.provider != LocationManager.GPS_PROVIDER &&
            lastLocationProvider == LocationManager.GPS_PROVIDER && current != null) return
        if (gpsTelemetry.accept(GpsTelemetryPolicy.Fix(
                latitude = location.latitude,
                longitude = location.longitude,
                altitudeMeters = if (location.hasAltitude()) location.altitude else null,
                speedMetersPerSecond = if (location.hasSpeed()) location.speed else null,
                elapsedRealtimeNanos = location.elapsedRealtimeNanos
            ), nowElapsed)) {
            lastLocationProvider = location.provider
            gpsTelemetry.current(nowElapsed)?.speedKmh?.let { speedKmh ->
                val ageMs = (nowElapsed - location.elapsedRealtimeNanos) / 1_000_000L
                processSpeedUpdate(speedKmh, System.currentTimeMillis() - ageMs)
            }
        }
    }

    // Registered listeners resume automatically when their provider is enabled.
    // Re-registering inside this callback can remove a subscription being set up.
    override fun onProviderEnabled(provider: String) {}

    override fun onProviderDisabled(provider: String) {
        if (provider == lastLocationProvider) gpsTelemetry.clear()
    }

    // This callback is abstract on the Android 10 head unit, although newer
    // Android SDKs supply a default implementation.
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        GatewayStatusStore.setRunning(false)
        persistencePolicy.reset()
        OutboxUploader.commandHandler = null
        stopAllJobs()
        serviceJob.cancel()
        foregroundReady = false
        try {
            bluetoothSocket?.close()
        } catch (error: IOException) {
            Log.w(TAG, "Unable to close the disconnected Bluetooth socket", error)
        }
        bluetoothSocket = null
        obdConnection = null
        try {
            locationManager?.removeUpdates(this)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        sendBroadcast(Intent("com.example.obdapp.STATUS_UPDATE").apply {
            setPackage(packageName)
            putExtra("status", stopStatus)
            putExtra("running", false)
        })
    }

    private fun stopAllJobs() {
        connectionJob?.cancel()
        connectionJob = null
        collectorJob?.cancel()
        collectorJob = null
        syncJob?.cancel()
        syncJob = null
    }

    private fun isAccOn(): Boolean {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val value = getMethod.invoke(null, "sys.qf.is.acc.on") as? String
            if (value.isNullOrEmpty()) {
                true // Non-QF head unit or standard Android: default to ACC ON!
            } else {
                value.equals("true", ignoreCase = true)
            }
        } catch (e: Exception) {
            true // Fallback to true if we can't read the property
        }
    }

    private fun readSystemPropVoltage(): Float? {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val rawValue = getMethod.invoke(null, "sys.qf.update_battery_power") as? String
            rawValue?.takeIf { it.isNotEmpty() }?.toFloatOrNull()?.div(10f)
        } catch (e: Exception) {
            null
        }
    }

    private fun isHeadlightOn(): Boolean? {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val value = getMethod.invoke(null, "sys.qf.vehicle.headlight_state") as? String
            if (value.isNullOrEmpty()) null else value.equals("true", ignoreCase = true)
        } catch (e: Exception) {
            null
        }
    }

    private fun getSystemVolume(): Int? {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val mediaVol = getMethod.invoke(null, "sys.media.vol") as? String
            val value = mediaVol?.takeIf { it.isNotEmpty() } ?: (getMethod.invoke(null, "persist.sys.main_volume") as? String)
            value?.toIntOrNull()
        } catch (e: Exception) {
            null
        }
    }

    private fun getWifiSsid(): String? {
        val wifiSsidFromManager = try {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val rawSsid = wifiManager?.connectionInfo?.ssid?.replace("\"", "")?.trim()
            if (!rawSsid.isNullOrEmpty() && rawSsid != "<unknown ssid>" && rawSsid != "0x") {
                rawSsid
            } else null
        } catch (e: Exception) {
            null
        }

        if (!wifiSsidFromManager.isNullOrEmpty()) {
            cachedFallbackWifiSsid = null
            return wifiSsidFromManager
        }

        // Fallback to ROCO/QF head unit system properties with a 60s TTL cache
        // to avoid expensive shell process spawning (getprop) on every loop tick
        val now = System.currentTimeMillis()
        if (now - lastFallbackWifiSsidTimestamp < FALLBACK_WIFI_SSID_REFRESH_MS) {
            return cachedFallbackWifiSsid
        }
        lastFallbackWifiSsidTimestamp = now

        cachedFallbackWifiSsid = try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val propSsid = getMethod.invoke(null, "persist.sys.last.wifi.ssid") as? String
            val trimmed = propSsid?.trim()?.takeIf { it.isNotEmpty() }
            if (trimmed != null) {
                trimmed
            } else {
                val p = Runtime.getRuntime().exec(arrayOf("getprop", "persist.sys.last.wifi.ssid"))
                p.inputStream.bufferedReader().readText().trim().takeIf { it.isNotEmpty() }
            }
        } catch (e: Exception) {
            null
        }

        return cachedFallbackWifiSsid
    }

    private fun isBtConnected(): Boolean? {
        if (obdConnection != null && bluetoothSocket?.isConnected == true) return true
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val value = getMethod.invoke(null, "sys.qf.bt.is.connect") as? String
            if (value.isNullOrEmpty()) null else value.equals("true", ignoreCase = true)
        } catch (e: Exception) {
            null
        }
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
