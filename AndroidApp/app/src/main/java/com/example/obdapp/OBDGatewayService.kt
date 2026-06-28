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
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

const val API_KEY = "SUPER_SECURE_OBD_APP_KEY_2026"

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

class OBDGatewayService : Service(), LocationListener {

    private val serviceJob = Job()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)
    private var bluetoothSocket: BluetoothSocket? = null
    private var obdConnection: ObdDeviceConnection? = null

    // Location fields
    private var locationManager: LocationManager? = null
    private var latitude: Double = 0.0
    private var longitude: Double = 0.0
    private var altitude: Double = 0.0
    private var gpsSpeed: Float = 0.0f

    // Standard SPP UUID for ELM327
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private var deviceMacAddress: String? = null

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
        return START_STICKY
    }

    private fun startTelemetrySync() {
        serviceScope.launch {
            val db = AppDatabase.getDatabase(applicationContext)
            val dao = db.telemetryDao()
            while (isActive) {
                try {
                    val unsyncedRecords = dao.getUnsyncedRecords()
                    if (unsyncedRecords.isNotEmpty()) {
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
                            }
                            jsonArray.put(jsonObj)
                        }

                        val prefs = getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
                        val apiUrl = prefs.getString("API_URL", "http://127.0.0.1:3000/api/telemetry/batch") ?: "http://127.0.0.1:3000/api/telemetry/batch"
                        val url = URL(apiUrl)
                        var connection: HttpURLConnection? = null
                        val success = try {
                            connection = url.openConnection() as HttpURLConnection
                            connection.requestMethod = "POST"
                            connection.setRequestProperty("Content-Type", "application/json")
                            connection.setRequestProperty("X-API-Key", API_KEY)
                            connection.doOutput = true
                            connection.connectTimeout = 5000
                            
                            val writer = OutputStreamWriter(connection.outputStream)
                            writer.write(jsonArray.toString())
                            writer.flush()
                            writer.close()
                            
                            connection.responseCode in 200..299
                        } catch (e: Exception) {
                            e.printStackTrace()
                            false
                        } finally {
                            connection?.disconnect()
                        }

                        if (success) {
                            unsyncedRecords.forEach { it.synced = true }
                            dao.updateRecords(unsyncedRecords)
                            dao.deleteSyncedRecords()
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                delay(3000)
            }
        }
    }

    private fun startObdPolling() {
        serviceScope.launch {
            try {
                try {
                    connectBluetooth()
                    // Initialize OBD
                    val initZ = object : ObdCommand() { override val tag = "AT Z"; override val name = "Reset"; override val mode = "AT Z"; override val pid = "AT Z" }
                    val initSP0 = object : ObdCommand() { override val tag = "AT SP 0"; override val name = "Select Protocol Auto"; override val mode = "AT SP 0"; override val pid = "AT SP 0" }
                    obdConnection?.run(initZ)
                    delay(500)
                    obdConnection?.run(initSP0)
                    delay(500)
                    updateNotification("OBD Polling Active")
                } catch (e: Exception) {
                    e.printStackTrace()
                    updateNotification("OBD: GPS Only (BT Fail)")
                }

                val db = AppDatabase.getDatabase(applicationContext)
                val dao = db.telemetryDao()

                while (isActive) {
                    try {
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
                            } catch (obdEx: Exception) {
                                obdEx.printStackTrace()
                            }
                        }

                        val telemetry = TelemetryEntity(
                            timestamp = System.currentTimeMillis(),
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
                            voltage = voltage
                        )
                        
                        dao.insert(telemetry)

                        val updateIntent = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
                            putExtra("lat", telemetry.latitude)
                            putExtra("lon", telemetry.longitude)
                            putExtra("alt", telemetry.altitude)
                            putExtra("speed", telemetry.gpsSpeed)
                            putExtra("rpm", telemetry.rpm ?: -1)
                            putExtra("coolant", telemetry.coolantTemp ?: -1)
                            putExtra("throttle", telemetry.throttlePos ?: -1)
                            putExtra("volt", telemetry.voltage ?: -1.0f)
                            putExtra("obd_status", if (obdConnection != null) "Connected" else "N/A")
                        }
                        sendBroadcast(updateIntent)
                        
                        delay(3000)
                    } catch (e: Exception) {
                        e.printStackTrace()
                        delay(3000)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                updateNotification("OBD Service Stopped")
            }
        }
    }

    private fun connectBluetooth() {
        val prefs = getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
        val mac = prefs.getString("MAC_ADDRESS", "")
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
            putExtra("status", text)
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
        serviceJob.cancel()
        bluetoothSocket?.close()
        try {
            locationManager?.removeUpdates(this)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
