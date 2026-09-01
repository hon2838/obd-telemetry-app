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
import kotlinx.coroutines.*
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

    private val serviceJob = Job()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    private var bluetoothSocket: BluetoothSocket? = null
    private var obdConnection: ObdDeviceConnection? = null
    private val obdMutex = Mutex()

    // Location fields
    private var locationManager: LocationManager? = null
    private var latitude: Double = 0.0
    private var longitude: Double = 0.0
    private var altitude: Double = 0.0
    private var gpsSpeed: Float = 0.0f

    // Standard SPP UUID for ELM327
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private var deviceMacAddress: String? = null

    private fun getSelectedObdMac(): String? {
        return VehiclePrefs.getActiveAdapterMac(this)
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(1, buildNotification("Initializing OBD Service..."))
        setupGPS()
    }

    private fun setupGPS() {
        try {
            locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                locationManager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 1.0f, this)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startObdPolling()
        startTelemetrySync()
        updateNotification("OBD: Service Running")
        return START_STICKY
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun startTelemetrySync() {
        serviceScope.launch {
            val db = AppDatabase.getDatabase(applicationContext)
            val dao = db.telemetryDao()
            var syncDelay = 60_000L
            val maxSyncDelay = 3600_000L

            while (isActive) {
                var hadFailures = false
                var hadSuccess = false
                try {
                    // Guard: no API key configured. The previous
                    // version of this app shipped a default key
                    // in the APK ("SUPER_SECURE_OBD_APP_KEY_2026")
                    // which made the shared secret recoverable
                    // by anyone who installed the app. The user
                    // now has to enter the key from the server's
                    // deploy config; until they do, we skip the
                    // sync and surface the problem in the
                    // notification so it's obvious instead of
                    // silently failing with 401s.
                    if (getApiKey(applicationContext).isEmpty()) {
                        updateNotification("OBD: API key not configured — open API Server Config to set it")
                        delay(syncDelay)
                        continue
                    }
                    // Only attempt sync if network is available
                    if (isNetworkAvailable()) {
                        val unsyncedRecords = dao.getUnsyncedRecords()
                        if (unsyncedRecords.isNotEmpty()) {
                            val jsonArray = JSONArray()
                            unsyncedRecords.forEach { record ->
                                val jsonObj = JSONObject().apply {
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

                            val apiUrl = "${getApiBaseUrl(this@OBDGatewayService)}/api/telemetry/batch"
                            val url = URL(apiUrl)
                            var connection: HttpURLConnection? = null
                            var responseBody = ""
                            val success = try {
                                connection = url.openConnection() as HttpURLConnection
                                connection.requestMethod = "POST"
                                connection.setRequestProperty("Content-Type", "application/json")
                                connection.setRequestProperty("X-API-Key", getApiKey(this@OBDGatewayService))
                                connection.doOutput = true
                                connection.connectTimeout = 5000

                                val writer = OutputStreamWriter(connection.outputStream)
                                writer.write(jsonArray.toString())
                                writer.flush()
                                writer.close()

                                val code = connection.responseCode
                                if (code in 200..299) {
                                    responseBody = connection.inputStream.bufferedReader().use { it.readText() }
                                    true
                                } else {
                                    false
                                }
                            } catch (e: Exception) {
                                e.printStackTrace()
                                false
                            } finally {
                                connection?.disconnect()
                            }

                            if (success) {
                                hadSuccess = true
                                unsyncedRecords.forEach { it.synced = true }
                                dao.updateRecords(unsyncedRecords)
                                dao.deleteSyncedRecords()

                                if (responseBody.isNotEmpty()) {
                                    try {
                                        val responseJson = JSONObject(responseBody)
                                        if (responseJson.has("commands")) {
                                            val commandsArray = responseJson.getJSONArray("commands")
                                            for (i in 0 until commandsArray.length()) {
                                                val cmd = commandsArray.getString(i)
                                                handleIncomingCommand(cmd)
                                            }
                                        }
                                    } catch (jsonEx: Exception) {
                                        jsonEx.printStackTrace()
                                    }
                                }
                            } else {
                                hadFailures = true
                            }
                        }

                        // Sync Fuel Logs (always runs, independent of OBD connection)
                        val fuelDao = db.fuelLogDao()
                        val unsyncedLogs = fuelDao.getUnsyncedLogs()
                        if (unsyncedLogs.isNotEmpty()) {
                            val fuelArray = JSONArray()
                            unsyncedLogs.forEach { log ->
                                val jsonObj = JSONObject().apply {
                                    put("id", log.id)
                                    put("vehicleId", log.vehicleId)
                                    put("timestamp", log.timestamp)
                                    put("litres", log.litres)
                                    put("odometer", log.odometer)
                                    put("source", "app")
                                }
                                fuelArray.put(jsonObj)
                            }

                            val fuelApiUrl = "${getApiBaseUrl(this@OBDGatewayService)}/api/fuel-logs"
                            val url = URL(fuelApiUrl)
                            var connection: HttpURLConnection? = null
                            val success = try {
                                connection = url.openConnection() as HttpURLConnection
                                connection.requestMethod = "POST"
                                connection.setRequestProperty("Content-Type", "application/json")
                                connection.setRequestProperty("X-API-Key", getApiKey(this@OBDGatewayService))
                                connection.doOutput = true
                                connection.connectTimeout = 5000
                                connection.readTimeout = 5000

                                val writer = OutputStreamWriter(connection.outputStream)
                                writer.write(fuelArray.toString())
                                writer.flush()
                                writer.close()

                                val code = connection.responseCode
                                code in 200..299
                            } catch (e: Exception) {
                                e.printStackTrace()
                                false
                            } finally {
                                connection?.disconnect()
                            }

                            if (success) {
                                hadSuccess = true
                                unsyncedLogs.forEach { it.synced = true }
                                fuelDao.updateLogs(unsyncedLogs)
                                fuelDao.deleteSyncedLogs()
                            } else {
                                hadFailures = true
                            }
                        }

                        // Sync Maintenance Items (always runs, independent of OBD connection)
                        val maintDao = db.maintenanceDao()
                        val unsyncedMaint = maintDao.getUnsyncedItems()
                        if (unsyncedMaint.isNotEmpty()) {
                            val maintArray = JSONArray()
                            unsyncedMaint.forEach { item ->
                                val jsonObj = JSONObject().apply {
                                    put("id", item.serverId)
                                    put("vehicleId", item.vehicleId)
                                    put("name", item.name)
                                    put("intervalKm", item.intervalKm ?: JSONObject.NULL)
                                    put("intervalDays", item.intervalDays ?: JSONObject.NULL)
                                    put("lastServiceOdo", item.lastServiceOdo ?: JSONObject.NULL)
                                    put("lastServiceDate", item.lastServiceDate ?: JSONObject.NULL)
                                    put("notes", item.notes)
                                }
                                maintArray.put(jsonObj)
                            }

                            val maintApiUrl = "${getApiBaseUrl(this@OBDGatewayService)}/api/maintenance"
                            val url = URL(maintApiUrl)
                            var connection: HttpURLConnection? = null
                            val success = try {
                                connection = url.openConnection() as HttpURLConnection
                                connection.requestMethod = "POST"
                                connection.setRequestProperty("Content-Type", "application/json")
                                connection.setRequestProperty("X-API-Key", getApiKey(this@OBDGatewayService))
                                connection.doOutput = true
                                connection.connectTimeout = 5000
                                connection.readTimeout = 5000

                                val writer = OutputStreamWriter(connection.outputStream)
                                writer.write(maintArray.toString())
                                writer.flush()
                                writer.close()

                                val code = connection.responseCode
                                code in 200..299
                            } catch (e: Exception) {
                                e.printStackTrace()
                                false
                            } finally {
                                connection?.disconnect()
                            }

                            if (success) {
                                hadSuccess = true
                                unsyncedMaint.forEach { it.synced = true }
                                maintDao.updateItems(unsyncedMaint)
                                maintDao.deleteSyncedItems()
                            } else {
                                hadFailures = true
                            }
                        }
                    }
                    // else: no network — data stays in local SQLite, will upload next cycle
                } catch (e: Exception) {
                    e.printStackTrace()
                    hadFailures = true
                }

                if (hadFailures && !hadSuccess) {
                    syncDelay = (syncDelay * 2).coerceAtMost(maxSyncDelay)
                } else if (hadSuccess) {
                    syncDelay = 60_000L
                }
                delay(syncDelay)
            }
        }
    }

    private fun handleIncomingCommand(cmd: String) {
        serviceScope.launch {
            if (obdConnection == null) return@launch
            try {
                if (cmd == "read_dtc") {
                    var dtcRaw = ""
                    obdMutex.withLock {
                        val dtcResp = obdConnection?.run(com.github.eltonvs.obd.command.control.TroubleCodesCommand())
                        dtcRaw = dtcResp?.formattedValue ?: ""
                    }
                    uploadDtcResult(dtcRaw)
                } else if (cmd == "clear_dtc") {
                    obdMutex.withLock {
                        obdConnection?.run(ResetTroubleCodesCommand())
                    }
                    uploadDtcClearStatus(true)
                }
            } catch (e: Exception) {
                e.printStackTrace()
                if (cmd == "read_dtc") uploadDtcResult("Error: ${e.message}")
                else if (cmd == "clear_dtc") uploadDtcClearStatus(false)
            }
        }
    }

    private fun uploadDtcResult(dtcRaw: String) {
        val serverUrl = getApiBaseUrl(this)
        val dtcUrl = "$serverUrl/api/dtc"
        serviceScope.launch {
            try {
                val url = URL(dtcUrl)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("X-API-Key", getApiKey(this@OBDGatewayService))
                conn.doOutput = true

                val payload = JSONObject().apply {
                    put("dtc", dtcRaw)
                    put("vehicleId", VehiclePrefs.getActiveVehicleId(this@OBDGatewayService))
                    put("timestamp", System.currentTimeMillis())
                }
                
                val writer = OutputStreamWriter(conn.outputStream)
                writer.write(payload.toString())
                writer.flush()
                writer.close()
                conn.responseCode
                conn.disconnect()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun uploadDtcClearStatus(success: Boolean) {
        val serverUrl = getApiBaseUrl(this)
        val dtcUrl = "$serverUrl/api/dtc/clear"
        serviceScope.launch {
            try {
                val url = URL(dtcUrl)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("X-API-Key", getApiKey(this@OBDGatewayService))
                conn.doOutput = true

                val payload = JSONObject().apply {
                    put("success", success)
                    put("vehicleId", VehiclePrefs.getActiveVehicleId(this@OBDGatewayService))
                    put("timestamp", System.currentTimeMillis())
                }
                
                val writer = OutputStreamWriter(conn.outputStream)
                writer.write(payload.toString())
                writer.flush()
                writer.close()
                conn.responseCode
                conn.disconnect()
            } catch (e: Exception) {
                e.printStackTrace()
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
        // Bluetooth reconnection runs on its own coroutine with backoff
        // so it never blocks the GPS telemetry recording loop below
        serviceScope.launch {
            var reconnectDelay = 5000L
            val maxReconnectDelay = 60000L
            while (isActive) {
                if (!isAccOn()) {
                    if (obdConnection != null) {
                        obdConnection = null
                        bluetoothSocket?.close()
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
                        updateNotification("OBD Connected")
                        reconnectDelay = 5000L
                    } catch (e: Exception) {
                        e.printStackTrace()
                        updateNotification("OBD: GPS Only Mode")
                        obdConnection = null
                        bluetoothSocket?.close()
                        bluetoothSocket = null
                        delay(reconnectDelay)
                        reconnectDelay = (reconnectDelay * 2).coerceAtMost(maxReconnectDelay)
                    }
                } else {
                    // Already connected — check again in 10s
                    delay(10000)
                }
            }
        }

        // Telemetry recording loop — always runs every 3s regardless of OBD state
        serviceScope.launch {
            val db = AppDatabase.getDatabase(applicationContext)
            val dao = db.telemetryDao()

            var accelStartTime: Long? = null
            var isTrackingAccel = false

            while (isActive) {
                try {
                    if (!isAccOn()) {
                        delay(5000)
                        continue
                    }
                    var rpm: Int? = null
                    var speed: Int? = null
                    var coolantTemp: Int? = null
                    var engineLoad: Int? = null
                    var throttlePos: Int? = null
                    var fuelLevel: Int? = null
                    var ambientTemp: Int? = null
                    var voltage: Float? = null

                    if (obdConnection != null) {
                        try {
                            obdMutex.withLock {
                                val rpmResp = obdConnection?.run(RPMCommand())
                                delay(100)
                                val speedResp = obdConnection?.run(SpeedCommand())
                                delay(100)
                                val coolantTempResp = obdConnection?.run(EngineCoolantTemperatureCommand())
                                delay(100)
                                val loadResp = obdConnection?.run(LoadCommand())
                                delay(100)
                                val throttleResp = obdConnection?.run(ThrottlePositionCommand())
                                delay(100)
                                val fuelLevelResp = obdConnection?.run(FuelLevelCommand())
                                delay(100)
                                val ambientTempResp = obdConnection?.run(AmbientAirTempCommand())
                                delay(100)
                                val voltageResp = obdConnection?.run(ModuleVoltageCommand())
                                delay(100)

                                rpm = rpmResp?.value?.toIntOrNull()
                                speed = speedResp?.value?.toIntOrNull()
                                coolantTemp = coolantTempResp?.value?.toIntOrNull()
                                engineLoad = loadResp?.value?.toIntOrNull()
                                throttlePos = throttleResp?.value?.toIntOrNull()
                                fuelLevel = fuelLevelResp?.value?.toIntOrNull()
                                ambientTemp = ambientTempResp?.value?.toIntOrNull()
                                voltage = voltageResp?.value?.toFloatOrNull()
                            }
                        } catch (obdEx: Exception) {
                            obdEx.printStackTrace()
                            obdConnection = null
                            bluetoothSocket?.close()
                            bluetoothSocket = null
                            updateNotification("OBD: Connection Lost — GPS Only")
                        }
                    }

                    if (voltage == null) {
                        voltage = readSystemPropVoltage()
                    }

                    // 0-100 km/h acceleration calculations
                    val currentSpeed = speed ?: 0
                    var completedAccelTime: Double? = null

                    if (currentSpeed == 0) {
                        accelStartTime = null
                        isTrackingAccel = false
                    } else if (currentSpeed > 0 && !isTrackingAccel && accelStartTime == null) {
                        accelStartTime = System.currentTimeMillis()
                        isTrackingAccel = true
                    }

                    if (isTrackingAccel && currentSpeed >= 100 && accelStartTime != null) {
                        completedAccelTime = (System.currentTimeMillis() - accelStartTime) / 1000.0
                        isTrackingAccel = false
                    }

                    val currentCoolant = coolantTemp
                    val currentVoltage = voltage
                    val isCoolantAlert = currentCoolant != null && currentCoolant > 105
                    val isVoltageAlert = currentVoltage != null && currentVoltage < 11.8f

                    if (isCoolantAlert) {
                        triggerLocalAlertNotification("Coolant Temperature Danger", "Engine Coolant is at $currentCoolant°C!")
                    }
                    if (isVoltageAlert) {
                        triggerLocalAlertNotification("Battery Voltage Warning", "System voltage is low: $currentVoltage V")
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
            val channel = NotificationChannel(
                "OBD_CHANNEL",
                "OBD Gateway Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
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
    }
    override fun onDestroy() {
        super.onDestroy()
        sendBroadcast(Intent("com.example.obdapp.STATUS_UPDATE").apply {
            setPackage(packageName)
            putExtra("status", "Service Stopped")
            putExtra("running", false)
        })
        serviceJob.cancel()
        bluetoothSocket?.close()
        try {
            locationManager?.removeUpdates(this)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun isAccOn(): Boolean {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val value = getMethod.invoke(null, "sys.qf.is.acc.on") as String
            value.equals("true", ignoreCase = true)
        } catch (e: Exception) {
            true // Fallback to true if we can't read the property
        }
    }

    private fun readSystemPropVoltage(): Float? {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val rawValue = getMethod.invoke(null, "sys.qf.update_battery_power") as String
            rawValue.toFloatOrNull()?.div(10f)
        } catch (e: Exception) {
            null
        }
    }

    private fun isHeadlightOn(): Boolean? {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val value = getMethod.invoke(null, "sys.qf.vehicle.headlight_state") as String
            value.equals("true", ignoreCase = true)
        } catch (e: Exception) {
            null
        }
    }

    private fun getSystemVolume(): Int? {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val value = getMethod.invoke(null, "persist.sys.main_volume") as String
            value.toIntOrNull()
        } catch (e: Exception) {
            null
        }
    }

    private fun getWifiSsid(): String? {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val value = getMethod.invoke(null, "persist.sys.last.wifi.ssid") as String
            if (value.isEmpty()) null else value
        } catch (e: Exception) {
            null
        }
    }

    private fun isBtConnected(): Boolean? {
        return try {
            val systemPropertiesClass = Class.forName("android.os.SystemProperties")
            val getMethod = systemPropertiesClass.getMethod("get", String::class.java)
            val value = getMethod.invoke(null, "sys.qf.bt.is.connect") as String
            value.equals("true", ignoreCase = true)
        } catch (e: Exception) {
            null
        }
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
