package com.example.obdapp

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Spinner
import android.widget.TextView
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive


class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button
    private lateinit var spinner: Spinner
    private lateinit var statusIndicator: android.view.View
    private lateinit var tvGpsPosition: TextView
    private lateinit var tvGpsSpeed: TextView
    private lateinit var tvAltitude: TextView
    private lateinit var tvObdStatus: TextView
    private lateinit var tvEngineRpm: TextView
    private lateinit var tvCoolantTemp: TextView
    private lateinit var tvThrottlePos: TextView
    private lateinit var tvVoltage: TextView
    private lateinit var tvAccState: TextView
    private lateinit var tvHeadlightState: TextView
    private lateinit var tvVolume: TextView
    private lateinit var tvWifiSsid: TextView
    private lateinit var tvBtConnected: TextView
    private lateinit var tvTelemetryAge: TextView

    private val mainJob = kotlinx.coroutines.Job()
    private val mainScope = CoroutineScope(Dispatchers.Main + mainJob)
    private val PERMISSION_REQUEST_CODE = 101
    private var suppressInitialSpinnerCallback = false
    private var lastTelemetryAt = 0L
    private var ageTicker: kotlinx.coroutines.Job? = null
    private var sparkline: SparklineView? = null

    private val telemetryReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent?.let {
                if (it.action == "com.example.obdapp.TELEMETRY_UPDATE") {
                    val lat = it.getDoubleExtra("lat", 0.0)
                    val lon = it.getDoubleExtra("lon", 0.0)
                    val alt = it.getDoubleExtra("alt", 0.0)
                    val speed = it.getFloatExtra("speed", 0.0f)
                    val obdStatus = it.getStringExtra("obd_status") ?: "N/A"
                    val rpm = it.getIntExtra("rpm", -1)
                    val coolant = it.getIntExtra("coolant", -1)
                    val throttle = it.getIntExtra("throttle", -1)
                    val volt = it.getFloatExtra("volt", -1.0f)
                    val accOn = it.getBooleanExtra("accOn", false)
                    val headlightOn = it.getBooleanExtra("headlightOn", false)
                    val volume = it.getIntExtra("volume", -1)
                    val wifiSsid = it.getStringExtra("wifiSsid") ?: ""
                    val btConnected = it.getBooleanExtra("btConnected", false)
                    val ts = it.getLongExtra("timestamp", 0L)
                    if (ts > 0) lastTelemetryAt = ts

                    tvGpsPosition.text = String.format("%.6f, %.6f", lat, lon)
                    tvGpsSpeed.text = String.format("%.1f km/h", speed)
                    tvAltitude.text = String.format("%.0f m", alt)
                    tvObdStatus.text = obdStatus

                    tvEngineRpm.text = if (rpm != -1) "$rpm RPM" else "N/A"
                    tvCoolantTemp.setTextColor(if (coolant > 105) getColor(R.color.accent_red) else getColor(R.color.text_primary))
                    tvThrottlePos.text = if (throttle != -1) "$throttle %" else "N/A"
                    tvVoltage.setTextColor(
                        when {
                            volt < 0f -> getColor(R.color.text_primary)
                            volt < 11.8f -> getColor(R.color.accent_red)
                            volt < 12.5f -> getColor(R.color.accent_amber)
                            else -> getColor(R.color.text_primary)
                        }
                    )
                    
                    sparkline?.push(if (rpm != -1) rpm else null, speed)

                    tvAccState.text = if (accOn) "ON" else "OFF"
                    tvHeadlightState.text = if (headlightOn) "ON" else "OFF"
                    tvVolume.text = if (volume != -1) volume.toString() else "N/A"
                    tvWifiSsid.text = if (wifiSsid.isNotEmpty()) wifiSsid else "N/A"
                    tvBtConnected.text = if (btConnected) "Connected" else "Disconnected"
                } else if (it.action == "com.example.obdapp.STATUS_UPDATE") {
                    val status = it.getStringExtra("status") ?: "Service Stopped"
                    val running = it.getBooleanExtra("running", status != "Service Stopped")
                    setServiceRunningUi(running)
                    updateStatusUi(status)
                }
            }
        }
    }

    private fun updateStatusUi(status: String) {
        statusText.text = status
        val colorRes = when {
            status.contains("Error", true) || status.contains("Lost", true) ||
                status.contains("Denied", true) -> R.color.accent_red
            status.contains("Connected", true) || status.contains("Running", true) -> R.color.accent_green
            status.contains("GPS Only", true) || status.contains("Suspended", true) ||
                status.contains("Connecting", true) -> R.color.accent_amber
            else -> R.color.text_muted
        }
        statusIndicator.backgroundTintList =
            android.content.res.ColorStateList.valueOf(getColor(colorRes))
    }

    private fun setServiceRunningUi(running: Boolean) {
        btnStart.isEnabled = !running
        btnStop.isEnabled = running
        btnStart.alpha = if (running) 0.5f else 1f
        btnStop.alpha = if (running) 1f else 0.5f
    }

    private fun updateTelemetryAge() {
        if (lastTelemetryAt == 0L) {
            tvTelemetryAge.text = getString(R.string.telemetry_waiting)
            tvTelemetryAge.setTextColor(getColor(R.color.text_muted))
            return
        }
        val ageSec = (System.currentTimeMillis() - lastTelemetryAt) / 1000
        tvTelemetryAge.text = if (ageSec < 5) getString(R.string.telemetry_live) else getString(R.string.telemetry_updated, ageSec)
        tvTelemetryAge.setTextColor(if (ageSec > 90) getColor(R.color.accent_red) else getColor(R.color.text_muted))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        AppNav.setup(this, AppNav.Page.GATEWAY)

        statusText = findViewById(R.id.statusText)
        btnStart = findViewById(R.id.btnStart)
        btnStop = findViewById(R.id.btnStop)
        spinner = findViewById(R.id.bluetoothDeviceSpinner)
        statusIndicator = findViewById(R.id.statusIndicator)
        tvGpsPosition = findViewById(R.id.tvGpsPosition)
        tvGpsSpeed = findViewById(R.id.tvGpsSpeed)
        tvAltitude = findViewById(R.id.tvAltitude)
        tvObdStatus = findViewById(R.id.tvObdStatus)
        tvEngineRpm = findViewById(R.id.tvEngineRpm)
        tvCoolantTemp = findViewById(R.id.tvCoolantTemp)
        tvThrottlePos = findViewById(R.id.tvThrottlePos)
        tvVoltage = findViewById(R.id.tvVoltage)
        tvAccState = findViewById(R.id.tvAccState)
        tvHeadlightState = findViewById(R.id.tvHeadlightState)
        tvVolume = findViewById(R.id.tvVolume)
        tvWifiSsid = findViewById(R.id.tvWifiSsid)
        tvBtConnected = findViewById(R.id.tvBtConnected)
        tvTelemetryAge = findViewById(R.id.tvTelemetryAge)
        sparkline = findViewById(R.id.sparkline)
        val etApiUrl = findViewById<EditText>(R.id.etApiUrl)
        val etApiKey = findViewById<EditText>(R.id.etApiKey)
        val btnApiSave = findViewById<Button>(R.id.btnApiSave)
        val cbAutoStart = findViewById<android.widget.CheckBox>(R.id.cbAutoStart)

        val prefs = getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
        
        cbAutoStart.isChecked = prefs.getBoolean("AUTO_START_BOOT", true)
        cbAutoStart.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("AUTO_START_BOOT", isChecked).apply()
        }

        // API Server Config card — persists the backend origin and ingest key
        // used by the gateway service, fuel sync, and TelemetrySyncWorker.
        etApiUrl.setText(getApiBaseUrl(this))
        etApiKey.setText(getApiKey(this))
        btnApiSave.setOnClickListener {
            val entered = etApiUrl.text.toString().trim()
            val keyEntered = etApiKey.text.toString().trim()
            if (!entered.startsWith("http://") && !entered.startsWith("https://")) {
                Toast.makeText(this, "URL must start with http:// or https://", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            saveApiBaseUrl(this, entered)
            if (keyEntered.isNotEmpty()) saveApiKey(this, keyEntered)
            Toast.makeText(this, "API settings saved", Toast.LENGTH_SHORT).show()
        }

        setupBluetoothSpinner()

        val autoStart = prefs.getBoolean("AUTO_START_BOOT", true)
        if (autoStart && !isServiceRunning(OBDGatewayService::class.java)) {
            if (checkAndRequestPermissions()) {
                startOBDService()
            }
        }

        btnStart.setOnClickListener {
            if (checkAndRequestPermissions()) {
                startOBDService()
            }
        }

        btnStop.setOnClickListener {
            stopOBDService()
        }

        val etFuelLitres = findViewById<EditText>(R.id.etFuelLitres)
        val etFuelOdometer = findViewById<EditText>(R.id.etFuelOdometer)
        val btnLogFuel = findViewById<Button>(R.id.btnLogFuel)

        btnLogFuel.setOnClickListener {
            val litresText = etFuelLitres.text.toString().trim()
            val odoText = etFuelOdometer.text.toString().trim()

            if (litresText.isEmpty() || odoText.isEmpty()) {
                Toast.makeText(this, "Please enter litres and odometer distance.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            try {
                val litres = litresText.toDouble()
                val odometer = odoText.toDouble()

                if (litres <= 0 || odometer <= 0) {
                    Toast.makeText(this, "Please enter valid positive numbers.", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                val fuelLog = FuelLogEntity(
                    timestamp = System.currentTimeMillis(),
                    litres = litres,
                    odometer = odometer
                )

                val db = AppDatabase.getDatabase(applicationContext)
                btnLogFuel.isEnabled = false
                mainScope.launch(Dispatchers.IO) {
                    try {
                        db.fuelLogDao().insert(fuelLog)

                        // Attempt immediate sync
                        try {
                            val unsyncedLogs = db.fuelLogDao().getUnsyncedLogs()
                            if (unsyncedLogs.isNotEmpty()) {
                                val fuelArray = org.json.JSONArray()
                                unsyncedLogs.forEach { log ->
                                    val jsonObj = org.json.JSONObject().apply {
                                        put("id", log.id)
                                        put("timestamp", log.timestamp)
                                        put("litres", log.litres)
                                        put("odometer", log.odometer)
                                        put("source", "app")
                                    }
                                    fuelArray.put(jsonObj)
                                }

                                val url = java.net.URL(getApiBaseUrl(this@MainActivity) + "/api/fuel-logs")
                                val connection = url.openConnection() as java.net.HttpURLConnection
                                connection.requestMethod = "POST"
                                connection.setRequestProperty("Content-Type", "application/json")
                                connection.setRequestProperty("X-API-Key", getApiKey(this@MainActivity))
                                connection.doOutput = true
                                connection.connectTimeout = 5000

                                val writer = java.io.OutputStreamWriter(connection.outputStream)
                                writer.write(fuelArray.toString())
                                writer.flush()
                                writer.close()

                                if (connection.responseCode in 200..299) {
                                    unsyncedLogs.forEach { it.synced = true }
                                    db.fuelLogDao().updateLogs(unsyncedLogs)
                                    db.fuelLogDao().deleteSyncedLogs()
                                }
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    } finally {
                        withContext(Dispatchers.Main) {
                            btnLogFuel.isEnabled = true
                            Toast.makeText(this@MainActivity, "Refuel logged successfully!", Toast.LENGTH_SHORT).show()
                            etFuelLitres.text.clear()
                            etFuelOdometer.text.clear()
                        }
                    }
                }
            } catch (e: java.lang.NumberFormatException) {
                Toast.makeText(this, "Please enter valid numbers.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun setupBluetoothSpinner() {
        val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
        val pairedDevices: Set<BluetoothDevice>? = bluetoothAdapter?.bondedDevices
        val deviceList = mutableListOf<String>()
        val macList = mutableListOf<String>()

        // Keep index 0 as explicit "no selection" to avoid auto-selecting a device.
        deviceList.add("Select OBD Adapter")
        macList.add("")

        if (!pairedDevices.isNullOrEmpty()) {
            for (device in pairedDevices) {
                deviceList.add("${device.name} (${device.address})")
                macList.add(device.address)
            }
        } else {
            deviceList.add("No paired Bluetooth devices found")
            macList.add("")
        }

        val adapter = ArrayAdapter(this, R.layout.spinner_closed_item, deviceList)
        adapter.setDropDownViewResource(R.layout.spinner_dropdown_item)
        spinner.adapter = adapter

        val prefs = getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
        val savedMac = prefs.getString("MAC_ADDRESS", "")
        if (!savedMac.isNullOrEmpty()) {
            val index = macList.indexOf(savedMac)
            if (index >= 0) {
                suppressInitialSpinnerCallback = true
                spinner.setSelection(index)
            }
        } else {
            prefs.edit().remove("MAC_ADDRESS").apply()
            spinner.setSelection(0)
        }

        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                if (suppressInitialSpinnerCallback) {
                    suppressInitialSpinnerCallback = false
                    return
                }

                val mac = macList[position]
                if (mac.isNotEmpty()) {
                    prefs.edit().putString("MAC_ADDRESS", mac).apply()
                } else {
                    prefs.edit().remove("MAC_ADDRESS").apply()
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun startOBDService() {
        val intent = Intent(this, OBDGatewayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        statusText.text = "Service Running..."
        setServiceRunningUi(true)
    }

    private fun stopOBDService() {
        val intent = Intent(this, OBDGatewayService::class.java)
        stopService(intent)
        setServiceRunningUi(false)
        updateStatusUi("Service Stopped")
    }

    private fun checkAndRequestPermissions(): Boolean {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            permissions.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }

        val listPermissionsNeeded = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (listPermissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                listPermissionsNeeded.toTypedArray(),
                PERMISSION_REQUEST_CODE
            )
            return false
        }
        return true
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                startOBDService()
            } else {
                statusText.text = "Permissions Denied. Service cannot start."
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val filter = android.content.IntentFilter().apply {
            addAction("com.example.obdapp.TELEMETRY_UPDATE")
            addAction("com.example.obdapp.STATUS_UPDATE")
        }
        registerReceiver(telemetryReceiver, filter)

        val isRunning = isServiceRunning(OBDGatewayService::class.java)
        setServiceRunningUi(isRunning)
        updateStatusUi(if (isRunning) "Service Running..." else "Service Stopped")

        // Tick once per second so the staleness caption ages without a broadcast
        ageTicker?.cancel()
        ageTicker = mainScope.launch {
            while (isActive) {
                delay(1000)
                updateTelemetryAge()
            }
        }
    }

    override fun onStop() {
        super.onStop()
        try {
            unregisterReceiver(telemetryReceiver)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        ageTicker?.cancel()
        ageTicker = null
    }

    override fun onDestroy() {
        super.onDestroy()
        mainJob.cancel()
    }

    private fun isServiceRunning(serviceClass: Class<*>): Boolean {
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        for (service in manager.getRunningServices(Integer.MAX_VALUE)) {
            if (serviceClass.name == service.service.className) {
                return true
            }
        }
        return false
    }
}
