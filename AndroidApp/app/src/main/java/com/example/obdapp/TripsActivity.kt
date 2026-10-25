package com.example.obdapp

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
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

class TripsActivity : AppCompatActivity() {

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val dateFmt = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        DashboardConfigManager.applySavedTheme(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_trips)

        AppNav.setup(this, AppNav.Page.TRIPS)
        fetchTrips()
    }

    private fun fetchTrips() {
        val base = getApiBaseUrl(this)
        val vid = VehiclePrefs.getActiveVehicleId(this)
        mainScope.launch(Dispatchers.IO) {
            try {
                val conn = URL("$base/api/drives?vehicle=$vid").openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 15000
                applyAuthHeader(conn, this@TripsActivity)
                val arr = org.json.JSONArray(conn.inputStream.bufferedReader().readText())

                val drives = (0 until arr.length()).map { arr.getJSONObject(it) }
                // API returns newest-first already
                val newestFirst = drives

                var totalKm = 0.0
                var bestScore = -1
                drives.forEach { d ->
                    val s = d.optJSONObject("summary")
                    totalKm += s?.optDouble("distanceKm", 0.0) ?: 0.0
                    val score = s?.optInt("driverScore", -1) ?: -1
                    if (score > bestScore) bestScore = score
                }

                withContext(Dispatchers.Main) {
                    findViewById<TextView>(R.id.statTotalTrips).text = drives.size.toString()
                    findViewById<TextView>(R.id.statTotalDistance).text = String.format(Locale.getDefault(), "%.0f", totalKm)
                    findViewById<TextView>(R.id.statBestScore).text = if (bestScore >= 0) "$bestScore" else "—"
                    renderTrips(newestFirst)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@TripsActivity, "Could not load trips: ${e.message}", Toast.LENGTH_SHORT).show()
                    container().removeAllViews()
                    container().addView(muted("Could not reach API server.", 13))
                }
            }
        }
    }

    private fun container(): LinearLayout = findViewById(R.id.tripsContainer)

    private fun renderTrips(drives: List<org.json.JSONObject>) {
        val c = container()
        c.removeAllViews()
        if (drives.isEmpty()) {
            c.addView(muted("No drives recorded yet. Start the gateway service in the car.", 13))
            return
        }
        drives.forEach { c.addView(tripRow(it)) }
    }

    private fun tripRow(drive: org.json.JSONObject): View {
        val s = drive.optJSONObject("summary") ?: org.json.JSONObject()
        val id = drive.optString("id", "?")
        val start = drive.optLong("startTime", 0)
        val durationMin = s.optInt("durationMin", 0)
        val distanceKm = s.optDouble("distanceKm", 0.0)
        val avgSpeed = s.optDouble("avgSpeed", 0.0)
        val maxSpeed = s.optDouble("maxSpeed", 0.0)
        val score = s.optInt("driverScore", -1)
        val harsh = s.optJSONObject("harshEvents")
        val accel = harsh?.optInt("accel", 0) ?: 0
        val brake = harsh?.optInt("brake", 0) ?: 0
        val points = s.optInt("pointCount", 0)
        val fuel = s.optDouble("fuelUsedPercent", 0.0)

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = androidx.core.content.ContextCompat.getDrawable(this@TripsActivity, R.drawable.card_bg)
            setPadding(36, 28, 36, 28)
            val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            params.bottomMargin = 28
            layoutParams = params
        }

        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        header.addView(TextView(this).apply {
            text = "Drive #$id"
            setTextColor(getColor(R.color.text_primary))
            textSize = 16f
            setTypeface(Typeface.DEFAULT_BOLD)
        })
        val when_ = TextView(this).apply {
            text = if (start > 0) dateFmt.format(Date(start)) else ""
            setTextColor(getColor(R.color.text_muted))
            textSize = 12f
        }
        header.addView(when_, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.END
            weight = 1f
            marginStart = 12
        })
        row.addView(header)

        row.addView(TextView(this).apply {
            text = String.format(Locale.getDefault(),
                "%.2f km  •  %d min  •  avg %.0f / max %.0f km/h", distanceKm, durationMin, avgSpeed, maxSpeed)
            setTextColor(getColor(R.color.text_secondary))
            textSize = 13f
            setPadding(0, 10, 0, 0)
        })

        row.addView(TextView(this).apply {
            text = "Safety $score/100  •  $accel accel / $brake brake"
            setTextColor(when {
                score in 90..100 -> getColor(R.color.accent_green_text)
                score in 70..89 -> getColor(R.color.accent_amber)
                else -> getColor(R.color.accent_red_text)
            })
            textSize = 12f
            setPadding(0, 6, 0, 0)
        })

        row.setOnClickListener {
            val detail = row.getTag(R.id.tag_trip_detail) as? TextView
            detail?.visibility = if (detail?.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        val detail = TextView(this).apply {
            text = buildString {
                append("Start ").append(if (start > 0) dateFmt.format(Date(start)) else "—")
                append("  •  End ").append(if (drive.optLong("endTime", 0) > 0) dateFmt.format(Date(drive.optLong("endTime"))) else "—").append('\n')
                append("$points telemetry points\n")
                append("Fuel used: ").append(if (fuel > 0) String.format(Locale.getDefault(), "%.2f%%", fuel) else "— (fuel level not reported)")
            }
            setTextColor(getColor(R.color.text_muted))
            textSize = 12f
            setPadding(0, 14, 0, 0)
            visibility = View.GONE
        }
        row.setTag(R.id.tag_trip_detail, detail)
        row.addView(detail)
        return row
    }

    private fun muted(text: String, sizeSp: Int): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(getColor(R.color.text_muted))
            textSize = sizeSp.toFloat()
        }
    }
}
