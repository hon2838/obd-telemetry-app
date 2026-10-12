package com.example.obdapp

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.widget.PopupMenu
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.util.Locale


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
    private lateinit var tvFuelEconomy: TextView
    private lateinit var tvAccState: TextView
    private lateinit var tvHeadlightState: TextView
    private lateinit var tvVolume: TextView
    private lateinit var tvWifiSsid: TextView
    private lateinit var tvBtConnected: TextView
    private lateinit var tvTelemetryAge: TextView
    private lateinit var tvIntakeAirTemp: TextView
    private lateinit var tvManifoldPressure: TextView
    private lateinit var tvEngineLoad: TextView
    private lateinit var tvMassAirFlow: TextView
    private lateinit var tvSprintTime: TextView
    private lateinit var tvFuelLoopStatus: TextView

    private val mainJob = kotlinx.coroutines.Job()
    private val mainScope = CoroutineScope(Dispatchers.Main + mainJob)
    private val PERMISSION_REQUEST_CODE = 101
    private var suppressInitialSpinnerCallback = false
    private var lastTelemetryAt = 0L
    private var lastFuelEconomy: Double? = null
    private var lastFuelRate: Double? = null
    private var fuelConnectionOk = false
    private var ageTicker: kotlinx.coroutines.Job? = null
    private var sparkline: SparklineView? = null

    private val telemetryReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent?.let {
                if (it.action == "com.example.obdapp.TELEMETRY_UPDATE") {
                    val lat = it.getDoubleExtra("lat", 0.0)
                    val lon = it.getDoubleExtra("lon", 0.0)
                    val alt = it.getDoubleExtra("alt", 0.0)
                    val speed = it.getFloatExtra("speed", -1.0f)
                    val speedSource = it.getStringExtra("speed_source") ?: "GPS"
                    val hasGpsFix = it.getBooleanExtra("gps_fix", lat != 0.0 || lon != 0.0)
                    val hasAltitude = it.getBooleanExtra("gps_altitude_valid", hasGpsFix)
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
                    lastTelemetryAt = ts.coerceAtLeast(0L)

                    tvGpsPosition.text = if (hasGpsFix) String.format("%.6f, %.6f", lat, lon) else "Waiting for GPS fix"
                    tvGpsSpeed.text = if (speed >= 0f) String.format("%.1f km/h (%s)", speed, speedSource) else "N/A"
                    tvAltitude.text = if (hasAltitude) String.format("%.0f m", alt) else "N/A"
                    tvObdStatus.text = obdStatus

                    tvEngineRpm.text = if (rpm != -1) "$rpm RPM" else "N/A"
                    tvCoolantTemp.text = if (coolant != -1) "$coolant °C" else "N/A"
                    tvCoolantTemp.setTextColor(if (coolant > 105) getColor(R.color.accent_red) else getColor(R.color.text_primary))
                    tvThrottlePos.text = if (throttle != -1) "$throttle %" else "N/A"
                    tvVoltage.text = if (volt >= 0f) String.format("%.1f V", volt) else "N/A"
                    tvVoltage.setTextColor(
                        when {
                            volt < 0f -> getColor(R.color.text_primary)
                            volt < 11.8f -> getColor(R.color.accent_red)
                            volt < 12.5f -> getColor(R.color.accent_amber)
                            else -> getColor(R.color.text_primary)
                        }
                    )

                    // Preserve a genuine zero at idle, but never show old data
                    // as a current consumption estimate.
                    lastFuelEconomy = it.getDoubleExtra("estimated_fuel_economy_kml", -1.0)
                    lastFuelRate = it.getDoubleExtra("estimated_fuel_rate_lph", -1.0)
                    fuelConnectionOk = obdStatus == "Connected"
                    updateFuelEstimate()

                    sparkline?.push(if (rpm != -1) rpm else null, speed.takeIf { value -> value >= 0f })

                    tvAccState.text = if (accOn) "ON" else "OFF"
                    tvHeadlightState.text = if (headlightOn) "ON" else "OFF"
                    tvVolume.text = if (volume != -1) volume.toString() else "N/A"
                    tvWifiSsid.text = if (wifiSsid.isNotEmpty()) wifiSsid else "N/A"
                    tvBtConnected.text = if (btConnected) "Connected" else "Disconnected"

                    // Expanded OBD gauges
                    val iat = it.getIntExtra("iat", -1)
                    val map = it.getIntExtra("map", -1)
                    val load = it.getIntExtra("load", -1)
                    val maf = it.getDoubleExtra("maf", -1.0)
                    val fuelStatus = it.getIntExtra("fuel_status", -1)

                    tvIntakeAirTemp.text = if (iat != -1) "$iat °C" else "N/A"
                    tvManifoldPressure.text = if (map != -1) "$map kPa" else "N/A"
                    tvEngineLoad.text = if (load != -1) "$load %" else "N/A"
                    tvMassAirFlow.text = if (maf >= 0.0) String.format(Locale.getDefault(), "%.1f g/s", maf) else "N/A"
                    
                    tvFuelLoopStatus.text = when (fuelStatus) {
                        1 -> "Open (Cold)"
                        2 -> "Closed Loop"
                        4 -> "Open (Load)"
                        8 -> "Open (Fault)"
                        16 -> "Closed (Fault)"
                        else -> "N/A"
                    }
                    tvFuelLoopStatus.setTextColor(
                        when (fuelStatus) {
                            2 -> getColor(R.color.accent_green)
                            1, 4 -> getColor(R.color.accent_amber)
                            8, 16 -> getColor(R.color.accent_red)
                            else -> getColor(R.color.text_primary)
                        }
                    )

                    val accelTime = if (it.hasExtra("accelTime")) it.getDoubleExtra("accelTime", -1.0) else -1.0
                    if (accelTime > 0.0) {
                        tvSprintTime.text = String.format(Locale.getDefault(), "%.2fs", accelTime)
                        tvSprintTime.setTextColor(getColor(R.color.accent_cyan))
                        Toast.makeText(this@MainActivity, String.format(Locale.getDefault(), "⚡ 0-100 km/h: %.2fs", accelTime), Toast.LENGTH_LONG).show()
                    } else if (tvSprintTime.text.isEmpty() || tvSprintTime.text.toString() == "N/A") {
                        tvSprintTime.text = "Ready"
                        tvSprintTime.setTextColor(getColor(R.color.text_primary))
                    }
                } else if (it.action == "com.example.obdapp.STATUS_UPDATE") {
                    val status = it.getStringExtra("status") ?: "Service Stopped"
                    val running = it.getBooleanExtra("running", status != "Service Stopped")
                    setServiceRunningUi(running)
                    if (status.contains("GPS Only", true) || status.contains("Lost", true) ||
                        status.contains("Suspended", true)) {
                        fuelConnectionOk = false
                        updateFuelEstimate()
                    }
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
        if (!running) {
            fuelConnectionOk = false
            lastFuelEconomy = null
            lastFuelRate = null
            updateFuelEstimate()
        }
        btnStart.isEnabled = !running
        btnStop.isEnabled = running
        btnStart.alpha = if (running) 0.5f else 1f
        btnStop.alpha = if (running) 1f else 0.5f
    }

    private fun updateTelemetryAge() {
        updateFuelEstimate()
        if (lastTelemetryAt == 0L) {
            tvTelemetryAge.text = getString(R.string.telemetry_waiting)
            tvTelemetryAge.setTextColor(getColor(R.color.text_muted))
            return
        }
        val ageSec = (System.currentTimeMillis() - lastTelemetryAt) / 1000
        tvTelemetryAge.text = if (ageSec < 5) getString(R.string.telemetry_live) else getString(R.string.telemetry_updated, ageSec)
        tvTelemetryAge.setTextColor(if (ageSec > 90) getColor(R.color.accent_red) else getColor(R.color.text_muted))
    }

    private fun updateFuelEstimate() {
        if (::tvFuelEconomy.isInitialized) tvFuelEconomy.text = FuelEstimateDisplay.format(
            lastFuelEconomy, lastFuelRate, lastTelemetryAt, System.currentTimeMillis(), fuelConnectionOk
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        AppNav.setup(this, AppNav.Page.GATEWAY)

        setupVehicleGarage()

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
        tvFuelEconomy = findViewById(R.id.tvFuelEconomy)
        tvAccState = findViewById(R.id.tvAccState)
        tvHeadlightState = findViewById(R.id.tvHeadlightState)
        tvVolume = findViewById(R.id.tvVolume)
        tvWifiSsid = findViewById(R.id.tvWifiSsid)
        tvBtConnected = findViewById(R.id.tvBtConnected)
        tvTelemetryAge = findViewById(R.id.tvTelemetryAge)
        tvIntakeAirTemp = findViewById(R.id.tvIntakeAirTemp)
        tvManifoldPressure = findViewById(R.id.tvManifoldPressure)
        tvEngineLoad = findViewById(R.id.tvEngineLoad)
        tvMassAirFlow = findViewById(R.id.tvMassAirFlow)
        tvSprintTime = findViewById(R.id.tvSprintTime)
        tvFuelLoopStatus = findViewById(R.id.tvFuelLoopStatus)
        sparkline = findViewById(R.id.sparkline)

        setupCollapsibleSettingsAndMenu()

        val etApiUrl = findViewById<EditText>(R.id.etApiUrl)
        val etApiKey = findViewById<EditText>(R.id.etApiKey)
        val btnApiSave = findViewById<Button>(R.id.btnApiSave)
        val cbAutoStart = findViewById<android.widget.CheckBox>(R.id.cbAutoStart)

        val prefs = getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
        
        val supportsBootStart = applicationInfo.targetSdkVersion < 31
        cbAutoStart.isChecked = supportsBootStart && prefs.getBoolean("AUTO_START_BOOT", true)
        cbAutoStart.isEnabled = supportsBootStart
        cbAutoStart.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("AUTO_START_BOOT", isChecked).apply()
        }

        // API Server Config card — persists the backend origin and ingest key
        // used by the gateway service and fuel sync.
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
            updateDeviceStatusUi()
            Toast.makeText(this, "API settings saved", Toast.LENGTH_SHORT).show()
        }

        findViewById<Button?>(R.id.btnPairDeviceCard)?.setOnClickListener { showPairingDialog() }
        updateDeviceStatusUi()

        setupBluetoothSpinner()

        val autoStart = supportsBootStart && prefs.getBoolean("AUTO_START_BOOT", true)
        if (autoStart && !OBDGatewayService.isRunning) {
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
                    odometer = odometer,
                    vehicleId = VehiclePrefs.getActiveVehicleId(this@MainActivity)
                )

                val db = AppDatabase.getDatabase(applicationContext)
                btnLogFuel.isEnabled = false
                mainScope.launch(Dispatchers.IO) {
                    try {
                        db.fuelLogDao().insert(fuelLog)

                        // Immediate delivery goes through the same serialized
                        // OutboxUploader as every other path: it uploads with
                        // the stable persisted eventId and deletes only rows
                        // the server acknowledges. Offline rows stay queued.
                        var statusMessage = "Refuel logged successfully!"
                        try {
                            val report = OutboxUploader.drainOutbox(applicationContext)
                            statusMessage = when {
                                report.totalAckedFuel > 0 -> "Refuel logged & synced!"
                                report.quarantinedVehicles.contains(fuelLog.vehicleId) ->
                                    "Refuel saved locally; server rejected the entry (check values)."
                                report.blockedVehicles.contains(fuelLog.vehicleId) ->
                                    "Refuel saved locally; vehicle not authorized on server."
                                report.hadNetworkFailures || report.hadIncompatibleServer ->
                                    "Refuel saved offline — will sync when connected."
                                else -> "Refuel logged successfully!"
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                            statusMessage = "Refuel saved offline — will sync when connected."
                        }
                        val finalMessage = statusMessage
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@MainActivity, finalMessage, Toast.LENGTH_LONG).show()
                        }
                    } finally {
                        withContext(Dispatchers.Main) {
                            btnLogFuel.isEnabled = true
                            etFuelLitres.text.clear()
                            etFuelOdometer.text.clear()
                        }
                    }
                }
            } catch (e: java.lang.NumberFormatException) {
                Toast.makeText(this, "Please enter valid numbers.", Toast.LENGTH_SHORT).show()
            }
        }

        if (!isDeviceConfigured(this)) {
            showPairingDialog()
        }
    }

    // Garage card: pick which vehicle new records belong to. Switching
    // the active vehicle also switches the OBD adapter selection (each
    // vehicle remembers its own paired ELM327).
    private fun setupVehicleGarage() {
        val vehicleSpinner = findViewById<Spinner>(R.id.vehicleSpinner)
        val btnAddVehicle = findViewById<TextView>(R.id.btnAddVehicle)
        val btnPairDevice = findViewById<TextView?>(R.id.btnPairDevice)

        val vehicles = VehiclePrefs.getVehicles(this)
        val names = vehicles.map { it.name }
        val adapter = ArrayAdapter(this, R.layout.spinner_closed_item, names)
        adapter.setDropDownViewResource(R.layout.spinner_dropdown_item)
        vehicleSpinner.adapter = adapter

        val activeId = VehiclePrefs.getActiveVehicleId(this)
        val activeIndex = vehicles.indexOfFirst { it.id == activeId }
        vehicleSpinner.setSelection(if (activeIndex >= 0) activeIndex else 0)

        vehicleSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            private var suppress = activeIndex >= 0
            override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                if (suppress) { suppress = false; return }
                VehiclePrefs.setActiveVehicle(this@MainActivity, vehicles[position].id)
                setupBluetoothSpinner() // re-select the adapter bound to this vehicle
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        btnAddVehicle.setOnClickListener { showAddVehicleDialog() }
        btnPairDevice?.setOnClickListener { showPairingDialog() }
    }

    private fun setupCollapsibleSettingsAndMenu() {
        val btnToggleSettings = findViewById<Button?>(R.id.btnToggleSettings)
        val settingsContainer = findViewById<View?>(R.id.settingsContainer)
        val mainScrollView = findViewById<ScrollView?>(R.id.mainScrollView)
        val btnMainMenu = findViewById<ImageButton?>(R.id.btnMainMenu)

        fun updateToggleText(visible: Boolean) {
            btnToggleSettings?.text = if (visible) {
                getString(R.string.btn_hide_settings)
            } else {
                getString(R.string.btn_show_settings)
            }
        }

        fun scrollToChild(target: View) {
            mainScrollView?.post {
                var topOffset = 0
                var current: View? = target
                while (current != null && current != mainScrollView) {
                    topOffset += current.top
                    val parent = current.parent
                    current = if (parent is View) parent else null
                }
                mainScrollView.smoothScrollTo(0, topOffset)
            }
        }

        btnToggleSettings?.setOnClickListener {
            val isCurrentlyVisible = settingsContainer?.visibility == View.VISIBLE
            val makeVisible = !isCurrentlyVisible
            settingsContainer?.visibility = if (makeVisible) View.VISIBLE else View.GONE
            updateToggleText(makeVisible)
            if (makeVisible) {
                scrollToChild(btnToggleSettings)
            }
        }

        btnMainMenu?.setOnClickListener { v ->
            val popup = PopupMenu(this, v)
            val isVisible = settingsContainer?.visibility == View.VISIBLE
            popup.menu.add(0, 1, 0, if (isVisible) getString(R.string.menu_hide_settings) else getString(R.string.menu_show_settings))
            popup.menu.add(0, 2, 1, getString(R.string.menu_gateway_service))
            popup.menu.add(0, 3, 2, getString(R.string.menu_add_vehicle))
            popup.menu.add(0, 4, 3, getString(R.string.menu_bluetooth_adapter))
            popup.menu.add(0, 5, 4, getString(R.string.menu_pair_device))
            popup.menu.add(0, 6, 5, getString(R.string.menu_api_config))
            popup.menu.add(0, 7, 6, getString(R.string.menu_log_fuel))

            popup.setOnMenuItemClickListener { item ->
                when (item.itemId) {
                    1 -> {
                        val makeVisible = !(settingsContainer?.visibility == View.VISIBLE)
                        settingsContainer?.visibility = if (makeVisible) View.VISIBLE else View.GONE
                        updateToggleText(makeVisible)
                        if (makeVisible && btnToggleSettings != null) {
                            scrollToChild(btnToggleSettings)
                        }
                        true
                    }
                    2 -> {
                        settingsContainer?.visibility = View.VISIBLE
                        updateToggleText(true)
                        val statusCard = findViewById<View?>(R.id.statusText)
                        if (statusCard != null) {
                            scrollToChild(statusCard)
                        }
                        true
                    }
                    3 -> {
                        settingsContainer?.visibility = View.VISIBLE
                        updateToggleText(true)
                        val vehicleSpinner = findViewById<View?>(R.id.vehicleSpinner)
                        if (vehicleSpinner != null) {
                            scrollToChild(vehicleSpinner)
                        }
                        showAddVehicleDialog()
                        true
                    }
                    4 -> {
                        settingsContainer?.visibility = View.VISIBLE
                        updateToggleText(true)
                        val bluetoothSpinner = findViewById<View?>(R.id.bluetoothDeviceSpinner)
                        bluetoothSpinner?.let {
                            scrollToChild(it)
                            it.performClick()
                        }
                        true
                    }
                    5 -> {
                        showPairingDialog()
                        true
                    }
                    6 -> {
                        settingsContainer?.visibility = View.VISIBLE
                        updateToggleText(true)
                        val etApiUrl = findViewById<View?>(R.id.etApiUrl)
                        etApiUrl?.let {
                            scrollToChild(it)
                            it.requestFocus()
                        }
                        true
                    }
                    7 -> {
                        settingsContainer?.visibility = View.VISIBLE
                        updateToggleText(true)
                        val etFuelLitres = findViewById<View?>(R.id.etFuelLitres)
                        etFuelLitres?.let {
                            scrollToChild(it)
                            it.requestFocus()
                        }
                        true
                    }
                    else -> false
                }
            }
            popup.show()
        }
    }

    private fun updateDeviceStatusUi() {
        val tvDeviceTokenStatus = findViewById<TextView?>(R.id.tvDeviceTokenStatus)
        val btnPairDeviceCard = findViewById<Button?>(R.id.btnPairDeviceCard)
        val token = getDeviceToken(this)
        val key = getApiKey(this)
        when {
            !token.isNullOrEmpty() -> {
                val preview = if (token.length > 14) "${token.take(12)}..." else token
                tvDeviceTokenStatus?.text = "Device Authorization: ✓ Paired ($preview)"
                tvDeviceTokenStatus?.setTextColor(getColor(R.color.accent_green))
                btnPairDeviceCard?.text = "Re-pair Head Unit via PIN / QR"
            }
            key.isNotEmpty() -> {
                tvDeviceTokenStatus?.text = "Device Authorization: Legacy API Key"
                tvDeviceTokenStatus?.setTextColor(getColor(R.color.accent_amber))
                btnPairDeviceCard?.text = "Pair Head Unit via PIN / QR"
            }
            else -> {
                tvDeviceTokenStatus?.text = "Device Authorization: Not Paired"
                tvDeviceTokenStatus?.setTextColor(getColor(R.color.accent_red))
                btnPairDeviceCard?.text = "Pair Head Unit via PIN / QR"
            }
        }
    }

    private fun generateQrBitmap(contents: String, sizePx: Int = 360): android.graphics.Bitmap? {
        return try {
            val hints = mapOf(com.google.zxing.EncodeHintType.MARGIN to 1)
            val bitMatrix = com.google.zxing.qrcode.QRCodeWriter().encode(
                contents,
                com.google.zxing.BarcodeFormat.QR_CODE,
                sizePx,
                sizePx,
                hints
            )
            val w = bitMatrix.width
            val h = bitMatrix.height
            val pixels = IntArray(w * h)
            for (y in 0 until h) {
                val offset = y * w
                for (x in 0 until w) {
                    pixels[offset + x] = if (bitMatrix.get(x, y)) -0x1000000 else -0x1
                }
            }
            val bitmap = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.RGB_565)
            bitmap.setPixels(pixels, 0, w, 0, 0, w, h)
            bitmap
        } catch (_: Exception) {
            null
        }
    }

    private var pairingJob: kotlinx.coroutines.Job? = null

    private fun showPairingDialog() {
        pairingJob?.cancel()
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 36, 48, 36)
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }
        val titleView = TextView(this).apply {
            text = "Pair Head Unit with Account"
            textSize = 18f
            setTextColor(getColor(R.color.accent_cyan))
            setTypeface(null, android.graphics.Typeface.BOLD)
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }
        val pinView = TextView(this).apply {
            text = "Connecting..."
            textSize = 28f
            setTextColor(getColor(R.color.text_primary))
            setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD)
            setPadding(0, 20, 0, 8)
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }
        val qrImageView = android.widget.ImageView(this).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(340, 340).apply {
                gravity = android.view.Gravity.CENTER_HORIZONTAL
                topMargin = 12
                bottomMargin = 12
            }
            visibility = android.view.View.GONE
        }
        val currentApiBase = getApiBaseUrl(this@MainActivity)
        val defaultPairUrl = currentApiBase.replace("obd-api.", "obd.").replace("/api", "")
        val descView = TextView(this).apply {
            text = "Requesting pairing code from server..."
            textSize = 12f
            setTextColor(getColor(R.color.text_muted))
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }
        val statusView = TextView(this).apply {
            text = "Waiting for server response..."
            textSize = 12f
            setTextColor(getColor(R.color.accent_amber))
            setPadding(0, 16, 0, 0)
            gravity = android.view.Gravity.CENTER_HORIZONTAL
        }
        layout.addView(titleView)
        layout.addView(pinView)
        layout.addView(qrImageView)
        layout.addView(descView)
        layout.addView(statusView)

        val builder = AlertDialog.Builder(this)
            .setView(layout)
            .setNegativeButton("Cancel") { d, _ ->
                pairingJob?.cancel()
                d.dismiss()
            }
        val dialog = builder.create()
        dialog.show()

        pairingJob = mainScope.launch(Dispatchers.IO) {
            try {
                val initUrl = java.net.URL("${getApiBaseUrl(this@MainActivity)}/api/auth/device/initiate")
                val conn = initUrl.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 8000
                conn.readTimeout = 15000

                val payload = org.json.JSONObject().apply {
                    put("fingerprint", DeviceIdentity.getHardwareFingerprint(this@MainActivity))
                }

                conn.outputStream.use { it.write(payload.toString().toByteArray()) }
                if (conn.responseCode in 200..299) {
                    val resp = org.json.JSONObject(conn.inputStream.bufferedReader().readText())
                    val code = resp.getString("pairingCode")
                    val pollToken = resp.getString("pollToken")
                    val fallbackQr = "$defaultPairUrl/pair?code=$code"
                    val qrUrl = resp.optString("qrUrl", fallbackQr).ifEmpty { fallbackQr }
                    val qrBitmap = generateQrBitmap(qrUrl, 340)

                    withContext(Dispatchers.Main) {
                        pinView.text = code
                        descView.text = "Scan the QR code or visit\n${qrUrl.substringBefore('?')}\nand enter the PIN above to link this car."
                        if (qrBitmap != null) {
                            qrImageView.setImageBitmap(qrBitmap)
                            qrImageView.visibility = android.view.View.VISIBLE
                        }
                        statusView.text = "Waiting for phone approval on dashboard..."
                    }

                    var approved = false
                    while (!approved && isActive) {
                        delay(2500)
                        try {
                            val pollUrl = java.net.URL("${getApiBaseUrl(this@MainActivity)}/api/auth/device/poll?token=$pollToken")
                            val pollConn = pollUrl.openConnection() as java.net.HttpURLConnection
                            pollConn.connectTimeout = 5000
                            pollConn.readTimeout = 15000
                            if (pollConn.responseCode in 200..299) {
                                val pollResp = org.json.JSONObject(pollConn.inputStream.bufferedReader().readText())
                                if (pollResp.optString("status") == "approved") {
                                    approved = true
                                    val token = pollResp.getString("deviceToken")
                                    val vId = pollResp.optString("vehicleId", "default")
                                    val vName = pollResp.optString("vehicleName", "Default Vehicle")

                                    saveDeviceToken(this@MainActivity, token)
                                    val existing = VehiclePrefs.getVehicles(this@MainActivity).find { it.id == vId }
                                    if (existing == null) {
                                        VehiclePrefs.addVehicle(this@MainActivity, vName, null, vId)
                                    } else if (existing.name != vName) {
                                        VehiclePrefs.updateVehicle(this@MainActivity, vId, name = vName)
                                    }
                                    VehiclePrefs.setActiveVehicle(this@MainActivity, vId)

                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(this@MainActivity, "Successfully paired to $vName!", Toast.LENGTH_LONG).show()
                                        updateDeviceStatusUi()
                                        setupVehicleGarage()
                                        dialog.dismiss()
                                        if (!OBDGatewayService.isRunning) {
                                            startOBDService()
                                        }
                                    }
                                }
                            }
                        } catch (_: Exception) { }
                    }
                } else {
                    withContext(Dispatchers.Main) {
                        statusView.text = "Failed to connect to pairing server."
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    statusView.text = "Error: ${e.message}"
                }
            }
        }
    }

    // Adds a vehicle in two steps: register with the server first (a
    // local-only id would make every subsequent ingest fail with
    // 400 Unknown vehicleId), then store the server-assigned id locally.
    // 409 (name already registered) counts as registered.
    private fun showAddVehicleDialog() {
        val input = EditText(this).apply {
            hint = "e.g. My Car, Wife's Car"
            setSingleLine(true)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Add Vehicle")
            .setMessage("Name the vehicle. Pair its OBD adapter in the Bluetooth section while it is selected.")
            .setView(input)
            .setPositiveButton("Add", null)
            .setNegativeButton("Cancel", null)
            .show()

        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { btn ->
            val name = input.text.toString().trim()
            if (name.isEmpty()) {
                Toast.makeText(this, "Vehicle name cannot be empty.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            btn.isEnabled = false
            mainScope.launch(Dispatchers.IO) {
                var serverId: String? = null
                try {
                    val conn = java.net.URL(getApiBaseUrl(this@MainActivity) + "/api/vehicles")
                        .openConnection() as java.net.HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Content-Type", "application/json")
                    applyAuthHeader(conn, this@MainActivity)
                    conn.doOutput = true
                    conn.connectTimeout = 8000
                    conn.readTimeout = 15000
                    conn.outputStream.use {
                        it.write(org.json.JSONObject().apply { put("name", name) }.toString().toByteArray())
                    }
                    val code = conn.responseCode
                    if (code == 201 || code == 409) {
                        serverId = try {
                            org.json.JSONObject(conn.inputStream.bufferedReader().readText()).optString("id")
                        } catch (_: Exception) { null }
                        if (serverId.isNullOrEmpty() && code == 409) {
                            // Duplicate name: server rejected with an error body.
                            // Resolve against the registry list instead.
                            val listConn = java.net.URL(getApiBaseUrl(this@MainActivity) + "/api/vehicles")
                                .openConnection() as java.net.HttpURLConnection
                            listConn.connectTimeout = 8000
                            listConn.readTimeout = 15000
                            val arr = org.json.JSONArray(listConn.inputStream.bufferedReader().readText())
                            for (i in 0 until arr.length()) {
                                val v = arr.optJSONObject(i) ?: continue
                                if (v.optString("name").equals(name, ignoreCase = true)) {
                                    serverId = v.optString("id")
                                    break
                                }
                            }
                        }
                    }
                } catch (_: Exception) { }
                withContext(Dispatchers.Main) {
                    btn.isEnabled = true
                    if (!serverId.isNullOrEmpty()) {
                        dialog.dismiss()
                        val vehicle = VehiclePrefs.addVehicle(this@MainActivity, name, null, serverId)
                        VehiclePrefs.setActiveVehicle(this@MainActivity, vehicle.id)
                        setupVehicleGarage()
                        setupBluetoothSpinner()
                        Toast.makeText(this@MainActivity, "Added ${vehicle.name}", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this@MainActivity, "Could not reach server — vehicle not added.", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun setupBluetoothSpinner() {
        val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
        val pairedDevices: Set<BluetoothDevice>? = if (GatewayPermissions.canAccessBluetooth(this)) {
            try { bluetoothAdapter?.bondedDevices } catch (_: SecurityException) { null }
        } else null
        val deviceList = mutableListOf<String>()
        val macList = mutableListOf<String>()

        // Keep index 0 as explicit "no selection" to avoid auto-selecting a device.
        deviceList.add("Select OBD Adapter")
        macList.add("")

        if (!pairedDevices.isNullOrEmpty()) {
            try {
                for (device in pairedDevices) {
                    deviceList.add("${device.name} (${device.address})")
                    macList.add(device.address)
                }
            } catch (_: SecurityException) {
                // A permission can be revoked while the paired-device list is being rebuilt.
            }
        } else {
            deviceList.add("No paired devices — pair the OBD adapter in Android Bluetooth settings")
            macList.add("")
        }

        val adapter = ArrayAdapter(this, R.layout.spinner_closed_item, deviceList)
        adapter.setDropDownViewResource(R.layout.spinner_dropdown_item)
        // Rebuilding the list must not clear a saved adapter when Bluetooth is
        // temporarily off or its bond has not appeared yet.
        suppressInitialSpinnerCallback = true
        spinner.adapter = adapter

        val savedMac = VehiclePrefs.getActiveAdapterMac(this)
        if (!savedMac.isNullOrEmpty()) {
            val index = macList.indexOf(savedMac)
            if (index >= 0) {
                spinner.setSelection(index)
            }
        } else {
            spinner.setSelection(0)
        }

        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                if (suppressInitialSpinnerCallback) {
                    suppressInitialSpinnerCallback = false
                    return
                }

                val mac = macList[position]
                VehiclePrefs.setActiveAdapterMac(this@MainActivity, mac.ifEmpty { null })
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun startOBDService() {
        if (!GatewayPermissions.granted(this)) return
        if (applicationInfo.targetSdkVersion >= 31 &&
            !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) {
            // Pairing can finish after the phone UI has gone into the background.
            // Collection must then wait for an explicit foreground start.
            statusText.text = "Paired. Open the app and press Start to collect."
            return
        }
        val intent = Intent(this, OBDGatewayService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (_: SecurityException) {
            statusText.text = "Cannot start collection. Check Bluetooth and location permissions."
            return
        } catch (_: IllegalStateException) {
            statusText.text = "Open the app and press Start to collect."
            return
        }
        statusText.text = "Service Running..."
        setServiceRunningUi(true)
        if (Build.VERSION.SDK_INT >= 33 && applicationInfo.targetSdkVersion >= 33 &&
            !GatewayPermissions.canPostNotifications(this)) {
            // Optional alerts: denial must not prevent foreground collection.
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 102)
        }
    }

    private fun stopOBDService() {
        val intent = Intent(this, OBDGatewayService::class.java)
        val accepted = stopService(intent)
        // Operational metadata only; helps distinguish an undelivered tap from
        // an OS refusal or a later service restart without logging telemetry.
        android.util.Log.i("OBDServiceControl", "Stop requested: accepted=$accepted, running=${OBDGatewayService.isRunning}")
        setServiceRunningUi(false)
        updateStatusUi("Service Stopped")
    }

    private fun checkAndRequestPermissions(): Boolean {
        val permissions = GatewayPermissions.required(Build.VERSION.SDK_INT, applicationInfo.targetSdkVersion)

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
                setupBluetoothSpinner()
                startOBDService()
            } else {
                statusText.text = "Permissions Denied. Service cannot start."
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Pairing happens in Android settings; refresh when returning to the app.
        setupBluetoothSpinner()
        val filter = android.content.IntentFilter().apply {
            addAction("com.example.obdapp.TELEMETRY_UPDATE")
            addAction("com.example.obdapp.STATUS_UPDATE")
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(telemetryReceiver, filter, "$packageName.permission.INTERNAL_BROADCAST", null,
                Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerLegacyTelemetryReceiver(filter)
        }

        // The collector runs in this process. Its published lifecycle state is
        // reliable on modern Android, unlike deprecated service enumeration.
        val isRunning = OBDGatewayService.isRunning
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

    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    private fun registerLegacyTelemetryReceiver(filter: android.content.IntentFilter) {
        // Called only below API 33, where NOT_EXPORTED is unavailable. The signature
        // permission enforces sender isolation on these older platforms as well.
        registerReceiver(telemetryReceiver, filter, "$packageName.permission.INTERNAL_BROADCAST", null)
    }

    override fun onDestroy() {
        super.onDestroy()
        mainJob.cancel()
    }

}
