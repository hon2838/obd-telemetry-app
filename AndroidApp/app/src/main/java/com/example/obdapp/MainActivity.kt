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
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button
    private lateinit var spinner: Spinner
    private lateinit var etApiUrl: EditText
    private lateinit var statusIndicator: android.view.View
    private lateinit var tvGpsPosition: TextView
    private lateinit var tvGpsSpeed: TextView
    private lateinit var tvAltitude: TextView
    private lateinit var tvObdStatus: TextView
    private lateinit var tvEngineRpm: TextView
    private lateinit var tvCoolantTemp: TextView
    private lateinit var tvThrottlePos: TextView
    private lateinit var tvVoltage: TextView

    private val PERMISSION_REQUEST_CODE = 101

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

                    tvGpsPosition.text = String.format("%.6f, %.6f", lat, lon)
                    tvGpsSpeed.text = String.format("%.1f km/h", speed)
                    tvAltitude.text = String.format("%.0f m", alt)
                    tvObdStatus.text = obdStatus

                    tvEngineRpm.text = if (rpm != -1) "$rpm RPM" else "N/A"
                    tvCoolantTemp.text = if (coolant != -1) "$coolant °C" else "N/A"
                    tvThrottlePos.text = if (throttle != -1) "$throttle %" else "N/A"
                    tvVoltage.text = if (volt >= 0.0f) String.format("%.1f V", volt) else "N/A"
                } else if (it.action == "com.example.obdapp.STATUS_UPDATE") {
                    val status = it.getStringExtra("status") ?: "Service Stopped"
                    updateStatusUi(status)
                }
            }
        }
    }

    private fun updateStatusUi(status: String) {
        statusText.text = status
        val colorHex = when {
            status.contains("Active") || status.contains("Polling") -> "#34C759" // Green
            status.contains("GPS Only") -> "#FF9500" // Amber
            status.contains("Error") -> "#FF3B30" // Red
            else -> "#8E8E93" // Gray
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            statusIndicator.backgroundTintList = android.content.res.ColorStateList.valueOf(android.graphics.Color.parseColor(colorHex))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

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
        etApiUrl = findViewById(R.id.etApiUrl)

        val prefs = getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
        val savedUrl = prefs.getString("API_URL", "http://127.0.0.1:3000/api/telemetry/batch")
        etApiUrl.setText(savedUrl)
        etApiUrl.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) {
                val url = s?.toString()?.trim() ?: ""
                if (url.isNotEmpty()) {
                    prefs.edit().putString("API_URL", url).apply()
                }
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        setupBluetoothSpinner()

        btnStart.setOnClickListener {
            if (checkAndRequestPermissions()) {
                startOBDService()
            }
        }

        btnStop.setOnClickListener {
            stopOBDService()
        }
    }

    private fun setupBluetoothSpinner() {
        val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
        val pairedDevices: Set<BluetoothDevice>? = bluetoothAdapter?.bondedDevices
        val deviceList = mutableListOf<String>()
        val macList = mutableListOf<String>()

        if (!pairedDevices.isNullOrEmpty()) {
            for (device in pairedDevices) {
                deviceList.add("${device.name} (${device.address})")
                macList.add(device.address)
            }
        } else {
            deviceList.add("No paired Bluetooth devices found")
            macList.add("")
        }

        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, deviceList)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinner.adapter = adapter

        val prefs = getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
        val savedMac = prefs.getString("MAC_ADDRESS", "")
        if (!savedMac.isNullOrEmpty()) {
            val index = macList.indexOf(savedMac)
            if (index >= 0) {
                spinner.setSelection(index)
            }
        }

        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                val mac = macList[position]
                if (mac.isNotEmpty()) {
                    prefs.edit().putString("MAC_ADDRESS", mac).apply()
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
    }

    private fun stopOBDService() {
        val intent = Intent(this, OBDGatewayService::class.java)
        stopService(intent)
        statusText.text = "Service Stopped"
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
        if (isRunning) {
            updateStatusUi("Service Running...")
        } else {
            updateStatusUi("Service Stopped")
        }
    }

    override fun onStop() {
        super.onStop()
        try {
            unregisterReceiver(telemetryReceiver)
        } catch (e: Exception) {
            e.printStackTrace()
        }
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
