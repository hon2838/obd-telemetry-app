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
                conn.doOutput = true
                conn.connectTimeout = 5000
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
                val body = conn.inputStream.bufferedReader().readText()
                val json = org.json.JSONObject(body)
                val latest = json.optJSONObject("latest") ?: org.json.JSONObject()
                val latestDtc = latest.optJSONObject("latestDtc")
                val latestClear = latest.optJSONObject("latestClearStatus")
                val history = json.optJSONArray("history")

                val codeStr = latestDtc?.optString("code") ?: ""
                val codes = codeStr.split(",", " ")
                    .map { it.trim().uppercase() }
                    .filter { Regex("^[PBUC]\\d{4}$").matches(it) }

                val details = if (codes.isNotEmpty()) lookupCodes(base, codes) else emptyList()

                withContext(Dispatchers.Main) {
                    renderStatus(latestDtc, latestClear)
                    renderCodes(codeStr, codes, details)
                    renderHistory(history)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@DiagnosticsActivity, "Could not reach API server.", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun lookupCodes(base: String, codes: List<String>): List<org.json.JSONObject> {
        return try {
            val conn = URL("$base/api/dtc/lookup").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 5000
            conn.outputStream.use {
                it.write(org.json.JSONArray(codes).toString().toByteArray())
            }
            val arr = org.json.JSONArray(conn.inputStream.bufferedReader().readText())
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun renderStatus(latestDtc: org.json.JSONObject?, latestClear: org.json.JSONObject?) {
        val pollText = if (latestDtc != null && !latestDtc.isNull("timestamp") && latestDtc.optLong("timestamp") > 0)
            java.text.SimpleDateFormat("MMM d, HH:mm:ss", java.util.Locale.getDefault())
                .format(java.util.Date(latestDtc.optLong("timestamp")))
            else "Never polled"
        findViewById<TextView>(R.id.tvLatestPoll).text = "Latest Poll Result: $pollText"

        val clearText = if (latestClear != null && !latestClear.isNull("timestamp") && latestClear.optLong("timestamp") > 0) {
            val t = java.text.SimpleDateFormat("MMM d, HH:mm:ss", java.util.Locale.getDefault())
                .format(java.util.Date(latestClear.optLong("timestamp")))
            val result = if (latestClear.optBoolean("success", false)) "Success" else "Failed"
            "Last Clear Request: $t ($result)"
        } else "Last Clear Request: None"
        findViewById<TextView>(R.id.tvLastClear).text = clearText
    }

    private fun renderCodes(codeStr: String, codes: List<String>, details: List<org.json.JSONObject>) {
        val container = findViewById<LinearLayout>(R.id.dtcListContainer)
        container.removeAllViews()

        if (codes.isEmpty()) {
            container.addView(infoLine("No fault codes detected.", Color.parseColor("#34C759")))
            if (codeStr.isNotBlank() && codeStr != "No trouble codes found" && codeStr != "No DTCs") {
                container.addView(infoLine("ECU raw response: \"$codeStr\"", Color.parseColor("#8E8E93")))
            }
            return
        }

        val detailByCode = details.associateBy { it.optString("code") }
        codes.forEach { code ->
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
            val codeList = (0 until (codesArr?.length() ?: 0)).map { codesArr!!.getString(it) }
            val summary = if (isRead) {
                if (codeList.isEmpty()) "Read scan — no codes, system healthy"
                else "Read scan — found: ${codeList.joinToString(", ")}"
            } else {
                if (ev.optBoolean("success", false)) "Clear command — succeeded"
                else "Clear command — failed/executing"
            }
            val color = if (!isRead && !ev.optBoolean("success", false))
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
