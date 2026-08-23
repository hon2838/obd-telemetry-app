package com.example.obdapp

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MaintenanceActivity : AppCompatActivity() {

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_maintenance)

        AppNav.setup(this, AppNav.Page.MAINT)

        findViewById<TextView>(R.id.btnCreateSchedule).setOnClickListener { createSchedule() }

        fetchMaintenance()
    }

    private fun fetchMaintenance() {
        val base = getApiBaseUrl(this)
        mainScope.launch(Dispatchers.IO) {
            try {
                val statusRaw = httpGet("$base/api/maintenance/status")
                val statusObj: org.json.JSONObject? = try {
                    if (statusRaw.isNotBlank()) org.json.JSONObject(statusRaw) else null
                } catch (_: Exception) { null }
                val schedArr = try { org.json.JSONArray(httpGet("$base/api/maintenance")) } catch (e: Exception) { org.json.JSONArray("[]") }

                withContext(Dispatchers.Main) {
                    renderStatus(statusObj)
                    renderSchedules(schedArr)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MaintenanceActivity, "Could not load maintenance schedules: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun httpGet(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        val code = conn.responseCode
        return if (code in 200..299) conn.inputStream.bufferedReader().readText() else ""
    }

    private fun createSchedule() {
        val name = findViewById<EditText>(R.id.etScheduleName).text.toString().trim()
        val kmStr = findViewById<EditText>(R.id.etIntervalKm).text.toString().trim()
        val daysStr = findViewById<EditText>(R.id.etIntervalDays).text.toString().trim()
        val notes = findViewById<EditText>(R.id.etServiceNotes).text.toString().trim()

        if (name.isEmpty()) {
            Toast.makeText(this, "Enter a schedule name.", Toast.LENGTH_SHORT).show()
            return
        }
        val km = kmStr.toIntOrNull()
        val days = daysStr.toIntOrNull()
        if ((km == null || km <= 0) && (days == null || days <= 0)) {
            Toast.makeText(this, "Enter at least one interval (KM or days).", Toast.LENGTH_SHORT).show()
            return
        }

        val obj = org.json.JSONObject().apply {
            put("name", name)
            put("intervalKm", kmStr.toIntOrNull() ?: 0)
            put("intervalDays", daysStr.toIntOrNull() ?: 0)
            if (notes.isNotBlank()) put("notes", notes)
        }
        val base = getApiBaseUrl(this)
        val self = this
        mainScope.launch(Dispatchers.IO) {
            try {
                val conn = URL("$base/api/maintenance").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 8000
                conn.outputStream.use { it.write(obj.toString().toByteArray()) }
                val code = conn.responseCode
                withContext(Dispatchers.Main) {
                    if (code in 200..299) {
                        Toast.makeText(self, "Schedule created.", Toast.LENGTH_SHORT).show()
                        findViewById<EditText>(R.id.etScheduleName).text.clear()
                        findViewById<EditText>(R.id.etIntervalKm).text.clear()
                        findViewById<EditText>(R.id.etIntervalDays).text.clear()
                        findViewById<EditText>(R.id.etServiceNotes).text.clear()
                        fetchMaintenance()
                    } else {
                        Toast.makeText(self, "Could not create schedule (HTTP $code).", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(self, "Could not create schedule: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun renderStatus(statusObj: org.json.JSONObject?) {
        val ok = statusObj?.optInt("okCount", 0) ?: 0
        val soon = statusObj?.optInt("dueSoonCount", 0) ?: 0
        val overdue = statusObj?.optInt("overdueCount", 0) ?: 0
        findViewById<TextView>(R.id.maintOkCount).text = ok.toString()
        findViewById<TextView>(R.id.maintSoonCount).text = soon.toString()
        findViewById<TextView>(R.id.maintOverdueCount).text = overdue.toString()
    }

    private fun renderSchedules(arr: org.json.JSONArray) {
        val c = findViewById<LinearLayout>(R.id.maintScheduleContainer)
        c.removeAllViews()

        if (arr.length() == 0) {
            c.addView(muted("Create a schedule to begin tracking engine parts degradation.", 13))
            return
        }

        for (i in 0 until arr.length()) {
            val item = arr.getJSONObject(i)
            c.addView(scheduleRow(item))
        }
    }

    private fun scheduleRow(item: org.json.JSONObject): View {
        val name = item.optString("name", "Unnamed schedule")
        val status = item.optString("status")
        val intervalKm = item.optLong("intervalKm", 0)
        val intervalDays = item.optLong("intervalDays", 0)
        val lastServiceOdo = item.optDouble("lastServiceOdo", Double.NaN)
        val lastServiceDate = item.optLong("lastServiceDate", 0)
        val kmSince = item.optDouble("kmSinceService", Double.NaN)
        val kmUntil = item.optDouble("kmUntilDue", Double.NaN)
        val daysSince = item.optInt("daysSinceService", -1)
        val daysUntil = item.optInt("daysUntilDue", Int.MAX_VALUE)
        val notes = item.optString("notes", "")

        val chipColor = when (status) {
            "overdue" -> Color.parseColor("#FF3B30")
            "due_soon" -> Color.parseColor("#FF9500")
            else -> Color.parseColor("#34C759")
        }
        val chipLabel = when (status) {
            "overdue" -> "OVERDUE"
            "due_soon" -> "DUE SOON"
            else -> "OK"
        }

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = androidx.core.content.ContextCompat.getDrawable(this@MaintenanceActivity, R.drawable.card_bg)
            setPadding(36, 28, 36, 28)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = 28
            }
        }

        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(TextView(this).apply {
            text = name
            setTextColor(Color.WHITE)
            textSize = 16f
            setTypeface(Typeface.DEFAULT_BOLD)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(TextView(this).apply {
            text = chipLabel
            setTextColor(chipColor)
            textSize = 11f
            setTypeface(Typeface.DEFAULT_BOLD)
            background = androidx.core.content.ContextCompat.getDrawable(this@MaintenanceActivity, R.drawable.spinner_bg)
            setPadding(18, 6, 18, 6)
        })
        row.addView(header)

        if (intervalKm > 0) {
            row.addView(TextView(this).apply {
                text = buildString {
                    if (!kmSince.isNaN()) append(String.format(Locale.getDefault(), "%.0f / %d km", kmSince, intervalKm))
                    if (!kmUntil.isNaN()) {
                        if (kmUntil <= 0) append(" — overdue!") else append(String.format(Locale.getDefault(), " • %.0f km left", kmUntil))
                    }
                }
                setTextColor(Color.parseColor("#AEAEB2"))
                textSize = 13f
                setPadding(0, 10, 0, 0)
            })
        }
        if (intervalDays > 0) {
            row.addView(TextView(this).apply {
                text = buildString {
                    if (daysSince >= 0) append("$daysSince / $intervalDays days")
                    if (daysUntil != Int.MAX_VALUE) {
                        if (daysUntil <= 0) append(" — overdue!") else append(" • $daysUntil days left")
                    }
                }
                setTextColor(Color.parseColor("#AEAEB2"))
                textSize = 13f
                setPadding(0, 4, 0, 0)
            })
        }
        if (!lastServiceOdo.isNaN()) {
            row.addView(TextView(this).apply {
                text = "Last service: ${String.format(Locale.getDefault(), "%,.0f", lastServiceOdo)} km" +
                        if (lastServiceDate > 0) " \u2022 ${SimpleDateFormat("MMM d, yyyy", Locale.getDefault()).format(Date(lastServiceDate))}" else ""
                setTextColor(Color.parseColor("#8E8E93"))
                textSize = 12f
                setPadding(0, 10, 0, 0)
            })
        }
        if (notes.isNotBlank()) {
            row.addView(TextView(this).apply {
                text = "Notes: $notes"
                setTextColor(Color.parseColor("#8E8E93"))
                textSize = 12f
                setPadding(0, 6, 0, 0)
            })
        }

        // Actions: Mark Serviced (PUT + current odometer) and Delete
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 18, 0, 0)
        }
        actions.addView(TextView(this).apply {
            text = "MARK SERVICED"
            setTextColor(Color.parseColor("#34C759"))
            textSize = 12f
            setTypeface(Typeface.DEFAULT_BOLD)
            background = androidx.core.content.ContextCompat.getDrawable(this@MaintenanceActivity, R.drawable.btn_diag_read_bg)
            setPadding(28, 14, 28, 14)
            isClickable = true; isFocusable = true
            setOnClickListener { markServiced(item.optString("id", item.optInt("id").toString())) }
        })
        actions.addView(TextView(this).apply {
            text = "DELETE"
            setTextColor(Color.parseColor("#FF6B62"))
            textSize = 12f
            setTypeface(Typeface.DEFAULT_BOLD)
            background = androidx.core.content.ContextCompat.getDrawable(this@MaintenanceActivity, R.drawable.btn_diag_clear_bg)
            setPadding(28, 14, 28, 14)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = 12 }
            isClickable = true; isFocusable = true
            setOnClickListener { confirmDelete(item.optString("id", item.optInt("id").toString())) }
        })
        row.addView(actions)

        return row
    }

    private fun markServiced(id: String) {
        val base = getApiBaseUrl(this)
        val self = this
        mainScope.launch(Dispatchers.IO) {
            try {
                // Refreshing the service baseline to "now" marks the current
                // odometer reading as the new last-service odometer.
                val conn = URL("$base/api/maintenance/$id").openConnection() as HttpURLConnection
                conn.requestMethod = "PUT"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 8000
                val body = org.json.JSONObject().apply {
                    put("lastServiceDate", System.currentTimeMillis())
                }.toString()
                conn.outputStream.use { it.write(body.toByteArray()) }
                val code = conn.responseCode
                withContext(Dispatchers.Main) {
                    if (code in 200..299) {
                        Toast.makeText(self, "Schedule marked as serviced.", Toast.LENGTH_SHORT).show()
                        fetchMaintenance()
                    } else {
                        Toast.makeText(self, "Could not mark as serviced (HTTP $code).", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(self, "Could not mark as serviced: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun confirmDelete(id: String) {
        AlertDialog.Builder(this)
            .setTitle("Delete schedule")
            .setMessage("Remove this maintenance schedule?")
            .setPositiveButton("Delete") { _, _ -> deleteSchedule(id) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun deleteSchedule(id: String) {
        val base = getApiBaseUrl(this)
        val self = this
        mainScope.launch(Dispatchers.IO) {
            try {
                val conn = URL("$base/api/maintenance/$id").openConnection() as HttpURLConnection
                conn.requestMethod = "DELETE"
                conn.connectTimeout = 8000
                val code = conn.responseCode
                withContext(Dispatchers.Main) {
                    if (code in 200..299) {
                        Toast.makeText(self, "Schedule deleted.", Toast.LENGTH_SHORT).show()
                        fetchMaintenance()
                    } else {
                        Toast.makeText(self, "Could not delete schedule (HTTP $code).", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(self, "Could not delete schedule: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
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
