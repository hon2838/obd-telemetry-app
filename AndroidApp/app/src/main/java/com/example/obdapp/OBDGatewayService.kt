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
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.github.eltonvs.obd.command.ObdCommand
import com.github.eltonvs.obd.command.ObdRawResponse
import com.github.eltonvs.obd.command.engine.RPMCommand
import com.github.eltonvs.obd.command.engine.SpeedCommand
import com.github.eltonvs.obd.command.temperature.EngineCoolantTemperatureCommand
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
import java.io.OutputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

// Define custom commands for parameters not built into eltonvs:kotlin-obd-api or to ensure compatibility
class LoadCommand : ObdCommand() {
    override val tag = "ENGINE_LOAD"
    override val name = "Engine Load"
    override val mode = "01"
    override val pid = "04"
    override val defaultUnit = "%"
    override val handler = { response: ObdRawResponse ->
        val raw = response.bufferedValue
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
        val raw = response.bufferedValue
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
        val raw = response.bufferedValue
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
        val raw = response.bufferedValue
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
        val raw = response.bufferedValue
        if (raw.isNotEmpty()) {
            val value = raw[0] and 0xFF
            (value - 40).toString()
        } else "0"
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
    private var obdConnection: ObdDeviceConnection? = null
    private val obdMutex = Mutex()
    private val commandMutex = Mutex()
    private var commandRecoveryJob: Job? = null

    // Owned singleton lifecycle jobs
    private var connectionJob: Job? = null
    private var collectorJob: Job? = null
    private var syncJob: Job? = null
    private val syncWakeupChannel = Channel<Unit>(Channel.CONFLATED)

    // Slow PID cache and timestamps
    @Volatile private var cachedCoolantTemp: Int? = null
    @Volatile private var cachedCoolantTimestamp: Long = 0L

    @Volatile private var cachedFuelLevel: Int? = null
    @Volatile private var cachedFuelLevelTimestamp: Long = 0L

    @Volatile private var cachedAmbientTemp: Int? = null
    @Volatile private var cachedAmbientTimestamp: Long = 0L

    @Volatile private var cachedModuleVoltage: Float? = null
    @Volatile private var cachedModuleVoltageTimestamp: Long = 0L

    private var slowPidIndex = 0

    private val COOLANT_REFRESH_MS = 15_000L
    private val VOLTAGE_REFRESH_MS = 20_000L
    private val FUEL_REFRESH_MS = 60_000L
    private val AMBIENT_REFRESH_MS = 60_000L

    @Volatile private var cachedFallbackWifiSsid: String? = null
    @Volatile private var lastFallbackWifiSsidTimestamp: Long = 0L
    private val FALLBACK_WIFI_SSID_REFRESH_MS = 60_000L

    // Location fields
    private var locationManager: LocationManager? = null
    private var latitude: Double = 0.0
    private var longitude: Double = 0.0
    private var altitude: Double = 0.0
    private var gpsSpeed: Float = 0.0f
    @Volatile private var lastGpsLocationTime: Long = 0L

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

    private fun getSelectedObdMac(): String? {
        return VehiclePrefs.getActiveAdapterMac(this)
    }

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        createNotificationChannel()
        startForeground(1, buildNotification("Initializing OBD Service..."))
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
        try {
            locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                locationManager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 1.0f, this)
                val lastLoc = locationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                    ?: locationManager?.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                    ?: locationManager?.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
                if (lastLoc != null) {
                    onLocationChanged(lastLoc)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
                        updateNotification("OBD: Car not paired — scan QR in app to pair")
                        waitForNextSync(syncDelay)
                        continue
                    }

                    if (isNetworkAvailable()) {
                        val report = OutboxUploader.drainOutbox(applicationContext)
                        hadSuccess = report.hadSuccess
                        hadFailures = report.hadNetworkFailures
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Telemetry sync error: ${e.message}", e)
                    hadFailures = true
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
                        connectBluetooth()
                        obdMutex.withLock {
                            val initZ = object : ObdCommand() { override val tag = "AT Z"; override val name = "Reset"; override val mode = "AT Z"; override val pid = "AT Z" }
                            val initSP0 = object : ObdCommand() { override val tag = "AT SP 0"; override val name = "Select Protocol Auto"; override val mode = "AT SP 0"; override val pid = "AT SP 0" }
                            obdConnection?.run(initZ)
                            delay(500)
                            obdConnection?.run(initSP0)
                            delay(500)
                        }
                        val matchedVehicle = VehiclePrefs.findVehicleByMac(this@OBDGatewayService, selectedMac)
                        if (matchedVehicle != null && matchedVehicle.id != VehiclePrefs.getActiveVehicleId(this@OBDGatewayService)) {
                            VehiclePrefs.setActiveVehicle(this@OBDGatewayService, matchedVehicle.id)
                        }
                        val activeName = VehiclePrefs.getActiveVehicle(this@OBDGatewayService).name
                        updateNotification("OBD Connected ($activeName)")
                        processPendingCommands()
                        reconnectDelay = 5000L
                    } catch (e: Exception) {
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
        val slowPidCandidates = 4
        for (step in 0 until slowPidCandidates) {
            val candidate = (slowPidIndex + step) % slowPidCandidates
            val shouldPoll = when (candidate) {
                0 -> (now - cachedCoolantTimestamp) >= COOLANT_REFRESH_MS
                1 -> (now - cachedModuleVoltageTimestamp) >= VOLTAGE_REFRESH_MS
                2 -> (now - cachedFuelLevelTimestamp) >= FUEL_REFRESH_MS
                3 -> (now - cachedAmbientTimestamp) >= AMBIENT_REFRESH_MS
                else -> false
            }
            if (shouldPoll) {
                slowPidIndex = (candidate + 1) % slowPidCandidates
                obdMutex.withLock {
                    if (obdConnection == null) return@withLock
                    when (candidate) {
                        0 -> {
                            val resp = obdConnection?.run(EngineCoolantTemperatureCommand())
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
                    }
                }
                break // Only poll at most ONE slow PID per cycle to preserve adapter fairness
            }
        }
    }

    private fun handleObdDisconnect() {
        obdConnection = null
        try {
            bluetoothSocket?.close()
        } catch (_: Exception) {}
        bluetoothSocket = null
        updateNotification("OBD: Connection Lost — GPS Only")
    }

    @Synchronized
    private fun startCollectorJob() {
        if (collectorJob?.isActive == true) return
        collectorJob = serviceScope.launch {
            val db = AppDatabase.getDatabase(applicationContext)
            val dao = db.telemetryDao()

            while (isActive) {
                try {
                    if (!isAccOn()) {
                        delay(5000)
                        continue
                    }
                    var rpm: Int? = null
                    var speed: Int? = null
                    var engineLoad: Int? = null
                    var throttlePos: Int? = null

                    // Fast OBD readings: short locked window with delay between commands
                    if (obdConnection != null) {
                        try {
                            obdMutex.withLock {
                                if (obdConnection != null) {
                                    val rpmResp = obdConnection?.run(RPMCommand())
                                    delay(100)
                                    val speedResp = obdConnection?.run(SpeedCommand())
                                    delay(100)
                                    val loadResp = obdConnection?.run(LoadCommand())
                                    delay(100)
                                    val throttleResp = obdConnection?.run(ThrottlePositionCommand())
                                    delay(100)

                                    rpm = rpmResp?.value?.toIntOrNull()
                                    speed = speedResp?.value?.toIntOrNull()
                                    engineLoad = loadResp?.value?.toIntOrNull()
                                    throttlePos = throttleResp?.value?.toIntOrNull()
                                }
                            }
                        } catch (obdEx: Exception) {
                            Log.w(TAG, "Fast OBD poll error: ${obdEx.message}")
                            handleObdDisconnect()
                        }
                    }

                    // Staggered slow PID polling: separate locked section, polling at most 1 slow PID per cycle
                    if (obdConnection != null) {
                        try {
                            pollStaggeredSlowPid()
                        } catch (obdEx: Exception) {
                            Log.w(TAG, "Slow OBD poll error: ${obdEx.message}")
                            handleObdDisconnect()
                        }
                    }

                    val coolantTemp = cachedCoolantTemp
                    val fuelLevel = cachedFuelLevel
                    val ambientTemp = cachedAmbientTemp
                    var voltage = cachedModuleVoltage ?: readSystemPropVoltage()

                    val curSpeed = speed
                    // If GPS has not provided recent updates (e.g. no GPS fix indoors), fallback to OBD speed
                    if (curSpeed != null && System.currentTimeMillis() - lastGpsLocationTime > 3000L) {
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

                    val telemetry = TelemetryEntity(
                        timestamp = System.currentTimeMillis(),
                        vehicleId = VehiclePrefs.getActiveVehicleId(this@OBDGatewayService),
                        rpm = rpm,
                        speed = speed,
                        coolantTemp = coolantTemp,
                        latitude = latitude,
                        longitude = longitude,
                        altitude = altitude,
                        gpsSpeed = gpsSpeed * 3.6f,
                        engineLoad = engineLoad,
                        throttlePos = throttlePos,
                        fuelLevel = fuelLevel,
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
                    dao.insert(telemetry)

                    val updateIntent = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
                        setPackage(packageName)
                        putExtra("lat", telemetry.latitude)
                        putExtra("lon", telemetry.longitude)
                        putExtra("alt", telemetry.altitude)
                        putExtra("speed", telemetry.gpsSpeed)
                        putExtra("rpm", telemetry.rpm ?: -1)
                        putExtra("coolant", telemetry.coolantTemp ?: -1)
                        putExtra("throttle", telemetry.throttlePos ?: -1)
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

                    delay(3000)
                } catch (e: Exception) {
                    e.printStackTrace()
                    delay(3000)
                }
            }
        }
    }

    private fun connectBluetooth() {
        val mac = getSelectedObdMac()
        if (mac.isNullOrEmpty()) {
            throw Exception("No Bluetooth Device Selected")
        }
        deviceMacAddress = mac

        val adapter = BluetoothAdapter.getDefaultAdapter()
        val device = adapter?.getRemoteDevice(deviceMacAddress)
        
        bluetoothSocket = device?.createRfcommSocketToServiceRecord(sppUuid)
        bluetoothSocket?.connect()
        
        val inputStream: InputStream = bluetoothSocket!!.inputStream
        val outputStream: OutputStream = bluetoothSocket!!.outputStream
        
        obdConnection = ObdDeviceConnection(inputStream, outputStream)
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
        notificationManager.notify(1, buildNotification(text))
        
        val statusIntent = Intent("com.example.obdapp.STATUS_UPDATE").apply {
            setPackage(packageName)
            putExtra("status", text)
            putExtra("running", true)
        }
        sendBroadcast(statusIntent)
    }

    override fun onLocationChanged(location: Location) {
        latitude = location.latitude
        longitude = location.longitude
        altitude = location.altitude
        gpsSpeed = location.speed
        lastGpsLocationTime = System.currentTimeMillis()

        // Feed GPS ground speed (m/s -> km/h) to 0-100 tracker
        val speedKmh = location.speed * 3.6f
        val locTime = if (location.time > 0) location.time else System.currentTimeMillis()
        processSpeedUpdate(speedKmh, locTime)
    }
    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        OutboxUploader.commandHandler = null
        stopAllJobs()
        serviceJob.cancel()
        bluetoothSocket?.close()
        bluetoothSocket = null
        obdConnection = null
        try {
            locationManager?.removeUpdates(this)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        sendBroadcast(Intent("com.example.obdapp.STATUS_UPDATE").apply {
            setPackage(packageName)
            putExtra("status", "Service Stopped")
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
