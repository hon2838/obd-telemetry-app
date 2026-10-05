package com.example.obdapp

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class FuelActivity : AppCompatActivity() {

    private data class FuelLogRow(
        val ts: Long, val litres: Double, val odo: Double, val source: String,
        val fillState: String, val economy: Double?, val economyStatus: String,
        val cycleDistance: Double?, val cycleLitres: Double?
    )

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val dateFmt = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_fuel)

        AppNav.setup(this, AppNav.Page.FUEL)
        fetchFuel()
    }

    private fun fetchFuel() {
        val base = getApiBaseUrl(this)
        val vid = VehiclePrefs.getActiveVehicleId(this)
        mainScope.launch(Dispatchers.IO) {
            try {
                val stats = org.json.JSONObject(httpGet("$base/api/fuel-stats?vehicle=$vid"))
                val logsJson = org.json.JSONArray(httpGet("$base/api/fuel-logs?vehicle=$vid"))
                withContext(Dispatchers.Main) {
                    renderFuel(stats, logsJson, vid == "all")
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@FuelActivity, "Could not load fuel data: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onDestroy() {
        mainScope.cancel()
        super.onDestroy()
    }

    private fun org.json.JSONObject.number(name: String): Double? =
        (opt(name) as? Number)?.toDouble()?.takeIf { it.isFinite() }

    internal fun renderFuel(stats: org.json.JSONObject, logsJson: org.json.JSONArray, fleet: Boolean = false) {
        val logs = (0 until logsJson.length()).map {
            val log = logsJson.getJSONObject(it)
            FuelLogRow(log.optLong("timestamp"), log.optDouble("litres", 0.0),
                log.optDouble("odometer", 0.0), log.optString("source"),
                log.optString("fillState", "unknown"), log.number("economy"),
                log.optString("economyStatus"), log.number("cycleDistance"), log.number("cycleLitres"))
        }
        renderStats(stats, logs, fleet)
        renderLogs(logs)
    }

    private fun httpGet(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 15000
        applyAuthHeader(conn, this)
        return conn.inputStream.bufferedReader().readText()
    }

    private fun renderStats(stats: org.json.JSONObject, logs: List<FuelLogRow>, fleet: Boolean) {
        val cycleCount = stats.number("cycleCount")?.takeIf { it >= 0 && it % 1.0 == 0.0 }?.toInt()
        findViewById<TextView>(R.id.statAvgEconomy).text =
            FuelHistoryDisplay.average(stats.number("averageKmPerLitre"), cycleCount, fleet)
        findViewById<TextView>(R.id.statEconomyRange).text =
            FuelHistoryDisplay.summary(cycleCount, stats.number("worstKmPerLitre"), stats.number("bestKmPerLitre"), fleet)
        findViewById<TextView>(R.id.statTotalLitres).text =
            String.format(Locale.getDefault(), "%.1f", stats.optDouble("totalLitres", 0.0))
        findViewById<TextView>(R.id.statLogCount).text = "${stats.optInt("logCount", 0)} logs"
        findViewById<TextView>(R.id.statTrackedKm).text =
            String.format(Locale.getDefault(), "%.0f", stats.optDouble("totalDistance", 0.0))
        val maxOdo = logs.maxOfOrNull { it.odo } ?: 0.0
        findViewById<TextView>(R.id.statCurrentOdo).text =
            if (!fleet && maxOdo > 0) String.format(Locale.getDefault(), "odo %,.0f km", maxOdo) else ""
    }

    private fun renderLogs(logs: List<FuelLogRow>) {
        val c = findViewById<LinearLayout>(R.id.fuelLogContainer)
        c.removeAllViews()

        if (logs.isEmpty()) {
            c.addView(muted("No refuel logs yet. Log a fill from the Gateway page.", 13))
            return
        }

        logs.forEach { log ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = androidx.core.content.ContextCompat.getDrawable(this@FuelActivity, R.drawable.card_bg)
                setPadding(36, 28, 36, 28)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = 28
                }
            }

            val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            header.addView(TextView(this).apply {
                text = String.format(Locale.getDefault(), "%.1f L", log.litres)
                setTextColor(Color.WHITE)
                textSize = 16f
                setTypeface(Typeface.DEFAULT_BOLD)
            })
            header.addView(TextView(this).apply {
                text = if (log.ts > 0) dateFmt.format(Date(log.ts)) else ""
                setTextColor(Color.parseColor("#8E8E93"))
                textSize = 12f
                gravity = Gravity.END
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { weight = 1f; marginStart = 12 })
            row.addView(header)

            val economyText = FuelHistoryDisplay.economy(log.economyStatus, log.economy, log.cycleDistance, log.cycleLitres)
            val fillLabel = when (log.fillState) {
                "full" -> "Full tank"
                "partial" -> "Partial fill"
                else -> "Unclassified fill"
            }

            row.addView(TextView(this).apply {
                text = "$economyText  •  $fillLabel  •  ${String.format(Locale.getDefault(), "%,.0f", log.odo)} km  •  ${if (log.source == "app") "logged in app" else "logged on web"}"
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
