package com.example.obdapp

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PerformanceActivity : AppCompatActivity() {

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val dateFmt = SimpleDateFormat("MMM d, yyyy", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_performance)

        AppNav.setup(this, AppNav.Page.PERF)
        fetchPerformance()
    }

    private fun fetchPerformance() {
        val base = getApiBaseUrl(this)
        val vid = VehiclePrefs.getActiveVehicleId(this)
        mainScope.launch(Dispatchers.IO) {
            try {
                val records = org.json.JSONObject(httpGet("$base/api/performance/records?vehicle=$vid"))
                val runs = org.json.JSONArray(httpGet("$base/api/performance/runs?vehicle=$vid"))
                withContext(Dispatchers.Main) {
                    renderRecords(records)
                    renderRuns(runs)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@PerformanceActivity, "Could not load performance data: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun httpGet(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        applyAuthHeader(conn, this)
        return conn.inputStream.bufferedReader().readText()
    }

    private fun formatDuration(mins: Int): String {
        val h = mins / 60
        val m = mins % 60
        return if (h <= 0) "${m}m" else if (m > 0) "${h}h ${m}m" else "${h}h"
    }

    private fun renderRecords(r: org.json.JSONObject) {
        val best = r.optJSONObject("best0to100")
        findViewById<TextView>(R.id.perfBest0to100).text =
            if (best != null && best.optDouble("time", Double.NaN).isNaN().not())
                String.format(Locale.getDefault(), "%.2fs", best.optDouble("time")) else "N/A"
        findViewById<TextView>(R.id.perfBest0to100Sub).text =
            if (best != null) "Drive #${best.optString("driveId")}" else "No runs recorded yet"

        val top = r.optJSONObject("topSpeed")
        findViewById<TextView>(R.id.perfTopSpeed).text =
            if (top != null && top.optDouble("speed", 0.0) > 0)
                String.format(Locale.getDefault(), "%.1f km/h", top.optDouble("speed")) else "N/A"
        findViewById<TextView>(R.id.perfTopSpeedSub).text =
            if (top != null && top.optDouble("speed", 0.0) > 0) {
                "Drive #${top.optString("driveId")} • ${dateFmt.format(Date(top.optLong("timestamp")))}"
            } else "No telemetry logged"

        val rpm = r.optJSONObject("highestRpm")
        findViewById<TextView>(R.id.perfHighestRpm).text =
            if (rpm != null && rpm.optDouble("rpm", 0.0) > 0)
                String.format(Locale.getDefault(), "%.0f RPM", rpm.optDouble("rpm")) else "N/A"
        findViewById<TextView>(R.id.perfHighestRpmSub).text =
            if (rpm != null && rpm.optDouble("rpm", 0.0) > 0)
                "Drive #${rpm.optString("driveId")}" else "No RPM data recorded"

        val longest = r.optJSONObject("longestDrive")
        findViewById<TextView>(R.id.perfLongestDrive).text =
            if (longest != null && longest.optInt("durationMin", 0) > 0)
                formatDuration(longest.optInt("durationMin")) else "N/A"
        findViewById<TextView>(R.id.perfLongestDriveSub).text =
            if (longest != null && longest.optInt("durationMin", 0) > 0)
                "Drive #${longest.optString("driveId")} • ${longest.optString("date")}" else "No drive sessions"

        val totalDrives = r.optInt("totalDrives", 0)
        val totalMin = r.optInt("totalDrivingTime", 0)
        findViewById<TextView>(R.id.perfLifetime).text =
            "Lifetime: $totalDrives drives • ${formatDuration(totalMin)} behind the wheel"
    }

    private fun renderRuns(runs: org.json.JSONArray) {
        val c = findViewById<LinearLayout>(R.id.runsContainer)
        c.removeAllViews()

        if (runs.length() == 0) {
            c.addView(muted("No acceleration runs recorded. Perform a full-throttle 0-100 km/h run with the gateway service running to log a sprint.", 13))
            return
        }

        for (i in 0 until runs.length()) {
            val run = runs.getJSONObject(i)
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = androidx.core.content.ContextCompat.getDrawable(this@PerformanceActivity, R.drawable.card_bg)
                setPadding(36, 28, 36, 28)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 28
                }
            }
            val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            header.addView(TextView(this).apply {
                text = String.format(Locale.getDefault(), "%.2f s", run.optDouble("accelTime", 0.0))
                setTextColor(Color.WHITE)
                textSize = 18f
                setTypeface(Typeface.DEFAULT_BOLD)
            })
            header.addView(TextView(this).apply {
                text = if (run.optLong("timestamp", 0) > 0)
                    SimpleDateFormat("MMM d, h:mm a", Locale.getDefault()).format(Date(run.optLong("timestamp"))) else ""
                setTextColor(Color.parseColor("#8E8E93"))
                textSize = 12f
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { weight = 1f; marginStart = 12; gravity = android.view.Gravity.END })
            row.addView(header)

            row.addView(TextView(this).apply {
                text = String.format(Locale.getDefault(),
                    "0-100 km/h  •  top speed %.1f km/h  •  Drive #%s",
                    run.optDouble("maxSpeedReached", 0.0), run.optString("driveId"))
                setTextColor(Color.parseColor("#AEAEB2"))
                textSize = 13f
                setPadding(0, 10, 0, 0)
            })
            c.addView(row)
        }
    }

    private fun muted(text: String, sizeSp: Int): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(Color.parseColor("#8E8E93"))
            textSize = sizeSp.toFloat()
        }
    }
}
