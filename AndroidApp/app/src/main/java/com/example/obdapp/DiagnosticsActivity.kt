package com.example.obdapp

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

class DiagnosticsActivity : AppCompatActivity() {

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var refreshPending = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_diagnostics)

        AppNav.setup(this, AppNav.Page.DIAGNOSTICS)

        findViewById<TextView>(R.id.btnReadDtc).setOnClickListener { queueCommand("read_dtc") }
        findViewById<TextView>(R.id.btnClearDtc).setOnClickListener { confirmAndClear() }

        fetchDiagnostics()
    }

    private fun confirmAndClear() {
        AlertDialog.Builder(this)
            .setTitle("Clear Trouble Codes")
            .setMessage("This clears stored DTCs and the check-engine light. Only do this after fixing the underlying issue. Queue clear command?")
            .setPositiveButton("Queue Clear") { _, _ -> queueCommand("clear_dtc") }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun queueCommand(command: String) {
        val base = getApiBaseUrl(this)
        mainScope.launch(Dispatchers.IO) {
            var ok = false
            var error = ""
            try {
                val conn = URL("$base/api/commands").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                applyAuthHeader(conn, this@DiagnosticsActivity)
                conn.doOutput = true
                conn.connectTimeout = 5000
                conn.readTimeout = 15000
                val body = org.json.JSONObject().apply {
                    put("command", command)
                    put("vehicleId", VehiclePrefs.getActiveVehicleId(this@DiagnosticsActivity))
                }.toString()
                conn.outputStream.use { it.write(body.toByteArray()) }
                ok = conn.responseCode in 200..299
                if (!ok) error = "HTTP ${conn.responseCode}"
            } catch (e: Exception) {
                error = e.message ?: "network error"
            }
            withContext(Dispatchers.Main) {
                if (ok) {
                    Toast.makeText(this@DiagnosticsActivity, "Command queued — head unit will run it when the vehicle connects.", Toast.LENGTH_LONG).show()
                    // Result lands on the server once the gateway executes it
                    if (!refreshPending) {
                        refreshPending = true
                        android.os.Handler(mainLooper).postDelayed({
                            refreshPending = false
                            fetchDiagnostics()
                        }, 4000)
                    }
                } else {
                    Toast.makeText(this@DiagnosticsActivity, "Failed to queue command ($error)", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun fetchDiagnostics() {
        val base = getApiBaseUrl(this)
        mainScope.launch(Dispatchers.IO) {
            try {
                val vid = VehiclePrefs.getActiveVehicleId(this@DiagnosticsActivity)
                val conn = URL("$base/api/telemetry/dtc?vehicle=$vid").openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 15000
                applyAuthHeader(conn, this@DiagnosticsActivity)
                val body = conn.inputStream.bufferedReader().readText()
                val json = org.json.JSONObject(body)
                val codes = readResult(json).codes
                val details = if (codes.isNotEmpty()) lookupCodes(base, codes) else emptyList()

                withContext(Dispatchers.Main) {
                    renderDiagnostics(json, details)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@DiagnosticsActivity, "Could not reach API server.", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onDestroy() {
        mainScope.cancel()
        super.onDestroy()
    }

    private fun readResult(json: org.json.JSONObject): DtcReadDisplay.Result {
        val latest = json.optJSONObject("latest")
        val dtc = latest?.optJSONObject("latestDtc")
        val dtcTimestamp = dtc?.optLong("timestamp")?.takeIf { it > 0 }
        val history = json.optJSONArray("history")
        val lastRead = (0 until (history?.length() ?: 0)).mapNotNull { history?.optJSONObject(it) }
            .filter { it.optString("type") == "read" }
            .maxByOrNull { it.optLong("timestamp") }
            ?.takeIf { it.optLong("timestamp") >= (dtcTimestamp ?: 0) }
        val status = latest?.optJSONObject("latestReadStatus") ?: lastRead
        val read = status?.let {
            DtcReadDisplay.ReadStatus(it.opt("success") as? Boolean,
                it.optLong("timestamp").takeIf { time -> time > 0 }, it.optString("error"))
        }
        return DtcReadDisplay.resolve(dtc?.optString("code") ?: "", dtcTimestamp, read)
    }

    internal fun renderDiagnostics(json: org.json.JSONObject, details: List<org.json.JSONObject> = emptyList()) {
        val result = readResult(json)
        renderStatus(result, json.optJSONObject("latest")?.optJSONObject("latestClearStatus"))
        renderCodes(result, details)
        renderHistory(json.optJSONArray("history"))
    }

    private fun lookupCodes(base: String, codes: List<String>): List<org.json.JSONObject> {
        return try {
            val conn = URL("$base/api/dtc/lookup").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            applyAuthHeader(conn, this@DiagnosticsActivity)
            conn.doOutput = true
            conn.connectTimeout = 5000
            conn.readTimeout = 15000
            conn.outputStream.use {
                it.write(org.json.JSONObject().put("codes", org.json.JSONArray(codes)).toString().toByteArray())
            }
            val arr = org.json.JSONArray(conn.inputStream.bufferedReader().readText())
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun renderStatus(result: DtcReadDisplay.Result, latestClear: org.json.JSONObject?) {
        val pollText = if (result.timestamp != null)
            java.text.SimpleDateFormat("MMM d, HH:mm:ss", java.util.Locale.getDefault())
                .format(java.util.Date(result.timestamp))
            else "Never polled"
        val readState = when (result.state) {
            DtcReadDisplay.State.FAILED -> "Failed"
            DtcReadDisplay.State.UNKNOWN -> "Unconfirmed"
            else -> "Successful"
        }
        findViewById<TextView>(R.id.tvLatestPoll).text = "Latest Poll Result: $pollText ($readState)"

        val clearText = if (latestClear != null && !latestClear.isNull("timestamp") && latestClear.optLong("timestamp") > 0) {
            val t = java.text.SimpleDateFormat("MMM d, HH:mm:ss", java.util.Locale.getDefault())
                .format(java.util.Date(latestClear.optLong("timestamp")))
            val result = if (latestClear.optBoolean("success", false)) "Success" else "Failed"
            "Last Clear Request: $t ($result)"
        } else "Last Clear Request: None"
        findViewById<TextView>(R.id.tvLastClear).text = clearText
    }

    private fun renderCodes(result: DtcReadDisplay.Result, details: List<org.json.JSONObject>) {
        val container = findViewById<LinearLayout>(R.id.dtcListContainer)
        container.removeAllViews()
        if (result.state == DtcReadDisplay.State.FAILED) {
            container.addView(infoLine("Latest scan failed; current fault status is unknown.", Color.parseColor("#FF9500")))
            result.error?.let { container.addView(infoLine("Read error: $it", Color.parseColor("#8E8E93"))) }
            if (result.historical) container.addView(infoLine("Previous successful scan result (historical):", Color.parseColor("#8E8E93")))
            if (result.historical && result.codes.isEmpty()) {
                container.addView(infoLine("Previous successful scan had no stored codes.", Color.parseColor("#8E8E93")))
            }
        } else if (result.state == DtcReadDisplay.State.UNKNOWN) {
            container.addView(infoLine("No confirmed scan result. Read codes when the vehicle connects.", Color.parseColor("#8E8E93")))
            return
        } else if (result.state == DtcReadDisplay.State.EMPTY) {
            container.addView(infoLine("No fault codes detected in the last successful scan.", Color.parseColor("#34C759")))
            return
        }

        val detailByCode = details.associateBy { it.optString("code") }
        result.codes.forEach { code ->
            val d = detailByCode[code]
            val severity = d?.optString("severity") ?: "info"
            val color = when (severity) {
                "severe" -> Color.parseColor("#FF3B30")
                "moderate" -> Color.parseColor("#FF9500")
                else -> Color.parseColor("#2563EB")
            }
            val badge = TextView(this).apply {
                text = code
                setTextColor(color)
                textSize = 16f
                setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
                background = androidx.core.content.ContextCompat.getDrawable(this@DiagnosticsActivity, R.drawable.spinner_bg)
                setPadding(24, 8, 24, 8)
            }
            val system = TextView(this).apply {
                text = d?.optString("system") ?: ""
                setTextColor(Color.parseColor("#8E8E93"))
                textSize = 11f
            }
            val header = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, 12, 0, 4)
                addView(badge)
                addView(system, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { leftMargin = 16 })
            }
            val desc = TextView(this).apply {
                text = d?.optString("description") ?: "No description available for this code."
                setTextColor(Color.parseColor("#AEAEB2"))
                textSize = 13f
                setPadding(0, 0, 0, 12)
            }
            container.addView(header)
            container.addView(desc)
        }
    }

    private fun renderHistory(history: org.json.JSONArray?) {
        val container = findViewById<LinearLayout>(R.id.historyContainer)
        container.removeAllViews()
        if (history == null || history.length() == 0) {
            container.addView(infoLine("No historical diagnostic events recorded.", Color.parseColor("#8E8E93")))
            return
        }
        // newest first
        for (i in (history.length() - 1) downTo 0) {
            val ev = history.getJSONObject(i)
            val isRead = ev.optString("type") == "read"
            val time = java.text.SimpleDateFormat("MMM d, HH:mm:ss", java.util.Locale.getDefault())
                .format(java.util.Date(ev.optLong("timestamp")))
            val codesArr = ev.optJSONArray("codes")
            val codeList = (0 until (codesArr?.length() ?: 0)).flatMap { DtcReadDisplay.codes(codesArr!!.optString(it)) }.distinct()
            val readSuccess = ev.opt("success") as? Boolean
            val summary = if (isRead) {
                if (readSuccess == false) "Read scan — failed: ${ev.optString("error", "No confirmed result") }"
                else if (codeList.isNotEmpty()) "Read scan — found: ${codeList.joinToString(", ")}"
                else if (readSuccess == true) "Read scan — no stored codes"
                else "Read scan — result unconfirmed"
            } else {
                if (ev.optBoolean("success", false)) "Clear command — succeeded"
                else "Clear command — failed/executing"
            }
            val color = if ((isRead && readSuccess == false) || (!isRead && !ev.optBoolean("success", false)))
                Color.parseColor("#FF9500")
            else if (isRead && codeList.isNotEmpty())
                Color.parseColor("#FF3B30")
            else Color.parseColor("#AEAEB2")
            container.addView(infoLine("$time — $summary", color))
        }
    }

    private fun infoLine(text: String, color: Int): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(color)
            textSize = 13f
            setPadding(0, 6, 0, 6)
        }
    }
}
