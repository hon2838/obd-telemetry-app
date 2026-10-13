package com.example.obdprobe

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** Foreground, local-only inspection. Stops and closes Bluetooth when leaving the app. */
class ProbeActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var operation: Job? = null
    @Volatile private var channel: BluetoothProbeChannel? = null
    private var session: ProbeSession? = null
    private var devices = emptyList<BluetoothDevice>()
    private val exchanges = ArrayDeque<ProbeExchange>()
    private val choices = linkedMapOf<Int, CheckBox>()
    private val readings = linkedMapOf<Int, TextView>()
    private val advertised = sortedSetOf<Int>()
    private val common = listOf(0x04, 0x05, 0x0C, 0x0D, 0x0F, 0x10, 0x11, 0x2F, 0x42, 0x46, 0x5C)
    private lateinit var deviceSpinner: Spinner
    private lateinit var paceSpinner: Spinner
    private lateinit var insecure: CheckBox
    private lateinit var identifiers: CheckBox
    private lateinit var status: TextView
    private lateinit var details: TextView
    private lateinit var raw: TextView
    private lateinit var rows: LinearLayout
    private lateinit var connect: Button
    private val queryButtons = mutableListOf<Button>()
    private var pendingExport: String? = null
    private var reportAdapter = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this)
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(24))
            setBackgroundColor(Color.rgb(19, 24, 32))
        }
        scroll.addView(body)
        setContentView(scroll)
        window.decorView.setOnApplyWindowInsetsListener { _, insets ->
            if (Build.VERSION.SDK_INT >= 35) {
                val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars())
                scroll.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            }
            insets
        }
        window.decorView.requestApplyInsets()
        body.addView(text("OBD Explorer", 27f))
        body.addView(text("Inspect your adapter and the car's standard OBD readings. Read-only, local-only.", 15f))
        body.addView(text("Use while parked, with ignition on. Disconnect other scanners from this adapter first; this app does not stop the telemetry app for you.", 14f))
        body.addView(button("Pair an adapter in Bluetooth settings") {
            startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        })
        body.addView(button("Refresh paired adapters") { refreshDevices(askPermission = true) })
        deviceSpinner = Spinner(this)
        body.addView(deviceSpinner)
        insecure = CheckBox(this).apply { text = "Compatible connection (try if secure connection fails)" }
        body.addView(insecure)
        connect = button("Connect selected adapter") { connectSelected() }
        body.addView(connect)
        body.addView(button("Stop / disconnect") { disconnect("Disconnected — no commands running") })
        status = text("Select a paired adapter to begin", 17f)
        status.accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        body.addView(status)
        details = text("No scan yet. Adapter support and vehicle support are different; a supported PID may still return NO DATA.", 14f)
        body.addView(details)
        identifiers = CheckBox(this).apply { text = "Include vehicle identity queries (VIN / calibration / ECU name)" }
        body.addView(identifiers)
        body.addView(queryButton("Discover supported readings") { discover() })
        body.addView(queryButton("Sample all discovered readings once") { sample() })
        body.addView(queryButton("Read stored, pending and permanent fault codes") { faults() })
        body.addView(text("Live pace: delay after each reply. Adapter response time adds to this.", 14f))
        paceSpinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@ProbeActivity, android.R.layout.simple_spinner_dropdown_item,
                listOf("250 ms", "500 ms", "1 second", "2 seconds"))
            setSelection(1)
        }
        body.addView(paceSpinner)
        body.addView(queryButton("Watch selected readings (up to 12)") { live() })
        rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(rows)
        body.addView(button("Export report") { exportReport() })
        body.addView(text("Raw replies — last 25 requests", 19f))
        raw = text("No requests sent", 12f).apply {
            typeface = android.graphics.Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        body.addView(raw)
        updateControls()
    }

    override fun onResume() { super.onResume(); refreshDevices() }
    override fun onStop() { disconnect("Disconnected because the app left the foreground"); super.onStop() }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float) = TextView(this).apply {
        text = value; textSize = size; setTextColor(Color.WHITE); setPadding(0, dp(8), 0, dp(8))
    }
    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label; setOnClickListener { action() }
    }
    private fun queryButton(label: String, action: () -> Unit) = button(label, action).also { queryButtons += it }
    private fun permitted() = Build.VERSION.SDK_INT < 31 ||
        checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    private fun refreshDevices(askPermission: Boolean = false) {
        if (!permitted()) {
            status.text = "Tap Refresh paired adapters and allow Nearby devices to list your adapters"
            if (askPermission) requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), 10)
            return
        }
        try {
            val adapter = getSystemService(BluetoothManager::class.java)?.adapter
            if (adapter == null || !adapter.isEnabled) {
                devices = emptyList()
                status.text = "Turn on Bluetooth, then refresh paired adapters"
            } else devices = adapter.bondedDevices.sortedBy { it.name ?: it.address }
            val selected = getPreferences(MODE_PRIVATE).getString("adapter", null)
            deviceSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
                if (devices.isEmpty()) listOf("No paired adapters") else devices.map { "${it.name ?: "Unnamed"} • ${it.address}" })
            devices.indexOfFirst { it.address == selected }.takeIf { it >= 0 }?.let { deviceSpinner.setSelection(it) }
            updateControls()
        } catch (error: SecurityException) { status.text = "Bluetooth permission changed. Refresh to retry." }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 10 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) refreshDevices()
    }

    @SuppressLint("MissingPermission")
    private fun connectSelected() {
        if (!permitted()) { refreshDevices(askPermission = true); return }
        val device = devices.getOrNull(deviceSpinner.selectedItemPosition) ?: return
        disconnect("Connecting…")
        try {
            val link = BluetoothProbeChannel(device, insecure.isChecked)
            channel = link
            reportAdapter = device.name ?: "Unnamed adapter"
            getPreferences(MODE_PRIVATE).edit().putString("adapter", device.address).apply()
            synchronized(exchanges) { exchanges.clear() }
            advertised.clear(); rows.removeAllViews(); readings.clear(); choices.clear()
            val probe = ProbeSession(link) { exchange ->
                synchronized(exchanges) {
                    if (channel !== link) return@synchronized
                    if (exchanges.size >= 300) exchanges.removeFirst()
                    exchanges.addLast(exchange.copy(response = exchange.response.take(4096)))
                }
            }
            session = probe
            runOperation("Connecting and identifying adapter…") {
                link.connect()
                probe.initialize()
                withContext(Dispatchers.Main) { details.text = "${adapterSummary()}\nDiscover the vehicle's capabilities next." }
            }
        } catch (error: Exception) { disconnect("Connection failed: ${error.message}") }
    }

    private fun runOperation(label: String, work: suspend () -> Unit) {
        if (operation?.isActive == true) return
        status.text = label
        operation = scope.launch(start = CoroutineStart.LAZY) {
            val thisJob = currentCoroutineContext()[Job]
            try {
                withContext(Dispatchers.IO) { work() }
                status.text = "Complete — adapter connected"
            } catch (cancelled: CancellationException) { throw cancelled
            } catch (error: Exception) {
                if (operation === thisJob) disconnect("Stopped: ${error.message}")
            } finally {
                if (operation === thisJob) {
                    operation = null
                    refreshRaw(); updateControls()
                }
            }
        }
        updateControls()
        operation?.start()
    }

    private fun discover() {
        val probe = session ?: return
        val includeIdentity = identifiers.isChecked
        runOperation("Discovering advertised sensors…") {
            val supported = probe.discover()
            val info = probe.discover(9)
            if (includeIdentity) {
                for (pid in listOf(2, 4, 6, 10).filter { it in info }) probe.query("09%02X".format(pid))
            }
            withContext(Dispatchers.Main) {
                advertised.clear(); advertised.addAll(supported)
                details.text = if (supported.isEmpty())
                    "No valid supported readings found. Check ignition, adapter compatibility and raw replies. Sample can try common read-only sensors."
                else "${adapterSummary()}\n${supported.size} advertised sensor PIDs. Vehicle-info PIDs: ${info.joinToString { "%02X".format(it) }.ifEmpty { "none reported" }}. Multiple ECU replies are combined; raw replies retain each response."
                populateReadings(if (supported.isEmpty()) common else supported.toList())
                refreshRaw()
            }
        }
    }

    private fun populateReadings(pids: List<Int>) {
        rows.removeAllViews(); choices.clear(); readings.clear()
        for (pid in pids) {
            val choice = CheckBox(this).apply {
                text = "${"%02X".format(pid)}  ${ProbeProtocol.label(pid)}"
                isChecked = pid in listOf(0x04, 0x05, 0x0C, 0x0D, 0x11)
            }
            val value = text("Not sampled", 14f)
            choices[pid] = choice; readings[pid] = value
            rows.addView(choice); rows.addView(value)
        }
    }

    private fun sample() {
        val probe = session ?: return
        if (readings.isEmpty()) populateReadings(common)
        val pids = readings.keys.toList()
        runOperation("Sampling ${pids.size} sensors once…") {
            for ((index, pid) in pids.withIndex()) {
                currentCoroutineContext().ensureActive()
                withContext(Dispatchers.Main) { status.text = "Sampling ${index + 1}/${pids.size}: ${ProbeProtocol.label(pid)}" }
                val value = probe.read(pid)
                withContext(Dispatchers.Main) { readings[pid]?.text = value; refreshRaw() }
                delay(200)
            }
        }
    }

    private fun live() {
        val probe = session ?: return
        if (choices.isEmpty()) populateReadings(common)
        val selected = choices.filterValues { it.isChecked }.keys.toList()
        if (selected.isEmpty() || selected.size > 12) {
            status.text = "Select between 1 and 12 readings for live monitoring"; return
        }
        val pause = listOf(250L, 500L, 1000L, 2000L)[paceSpinner.selectedItemPosition]
        runOperation("Watching ${selected.size} readings — Stop disconnects the adapter") {
            while (currentCoroutineContext().isActive) {
                for (pid in selected) {
                    currentCoroutineContext().ensureActive()
                    val value = probe.read(pid)
                    withContext(Dispatchers.Main) {
                        readings[pid]?.text = "$value  • ${java.text.SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(java.util.Date())}"
                        refreshRaw()
                    }
                    delay(pause)
                }
            }
        }
    }

    private fun faults() {
        val probe = session ?: return
        runOperation("Reading fault-code replies without clearing them…") {
            for (command in listOf("03", "07", "0A")) probe.query(command)
            withContext(Dispatchers.Main) { details.text = "Fault-code replies captured: 03 stored, 07 pending, 0A permanent. See raw replies or export. No codes were cleared." }
        }
    }

    private fun refreshRaw() {
        val recent = synchronized(exchanges) { exchanges.toList().takeLast(25) }
        raw.text = recent.joinToString("\n\n") { "${it.command} (${it.durationMs} ms)\n${it.response.take(512)}" }.ifEmpty { "No requests sent" }
    }

    private fun adapterSummary(): String {
        val labels = mapOf("ATI" to "Adapter banner", "ATRV" to "Adapter voltage", "ATDP" to "Protocol", "ATDPN" to "Protocol number")
        val recent = synchronized(exchanges) { exchanges.toList() }
        return labels.mapNotNull { (command, label) -> recent.lastOrNull { it.command == command }
            ?.let { "$label: ${it.response.take(120)}" } }.joinToString("\n")
    }

    private fun disconnect(message: String) {
        operation?.cancel(); operation = null
        channel?.close(); channel = null; session = null
        if (::status.isInitialized) { status.text = message; updateControls() }
    }

    private fun updateControls(finishing: Boolean = false) {
        val busy = !finishing && operation?.isActive == true
        // LAZY jobs are new rather than active until start().
        val pending = !finishing && operation != null && operation?.isCompleted == false
        connect.isEnabled = channel == null && devices.isNotEmpty() && !busy && !pending
        queryButtons.forEach { it.isEnabled = session != null && !busy && !pending }
    }

    private fun exportReport() {
        if (operation?.isActive == true) { status.text = "Stop / disconnect before exporting the completed report"; return }
        val history = synchronized(exchanges) { exchanges.toList() }
        val report = JSONObject().put("app", "OBD Explorer").put("version", "0.1.0")
            .put("capturedAt", System.currentTimeMillis()).put("adapter", reportAdapter)
            .put("advertisedPids", JSONArray(advertised.toList()))
            .put("note", "Standard read-only requests; raw responses may contain VIN if identity queries were enabled. Responses capped at 4096 characters; last 300 requests retained.")
            .put("requests", JSONArray(history.map { JSONObject().put("command", it.command)
                .put("response", it.response).put("durationMs", it.durationMs) }))
        pendingExport = report.toString(2)
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "obd-explorer-${System.currentTimeMillis()}.json")
        }, 20)
    }

    @Deprecated("Uses the platform result API to keep the probe dependency footprint small")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 20) return
        val content = pendingExport; pendingExport = null
        val uri = data?.data
        if (resultCode != RESULT_OK || content == null || uri == null) return
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val stream = contentResolver.openOutputStream(uri) ?: error("Cannot open report destination")
                    stream.bufferedWriter().use { it.write(content) }
                }
                status.text = "Report saved"
            } catch (error: Exception) { status.text = "Could not save report: ${error.message}" }
        }
    }
}
