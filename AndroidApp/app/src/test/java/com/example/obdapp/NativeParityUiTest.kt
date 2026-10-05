package com.example.obdapp

import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class NativeParityUiTest {

    @Test
    fun fuelActivityRendersCycleStatsAndExplicitFillStates() {
        val controller = Robolectric.buildActivity(FuelActivity::class.java).setup()
        try {
            val activity = controller.get()

            val stats = JSONObject().apply {
                put("averageKmPerLitre", 14.25)
                put("worstKmPerLitre", 12.5)
                put("bestKmPerLitre", 15.0)
                put("totalLitres", 90.0)
                put("totalDistance", 1200.0)
                put("logCount", 3)
                put("cycleCount", 1)
            }

            val logsJson = JSONArray().apply {
                put(JSONObject().apply {
                    put("timestamp", 1700000003000L)
                    put("litres", 40.0)
                    put("odometer", 1200.0)
                    put("source", "app")
                    put("fillState", "full")
                    put("economy", 14.25)
                    put("economyStatus", "full-cycle")
                    put("cycleDistance", 570.0)
                    put("cycleLitres", 40.0)
                })
                put(JSONObject().apply {
                    put("timestamp", 1700000002000L)
                    put("litres", 15.0)
                    put("odometer", 800.0)
                    put("source", "web")
                    put("fillState", "partial")
                    put("economyStatus", "partial-fill")
                })
                put(JSONObject().apply {
                    put("timestamp", 1700000001000L)
                    put("litres", 35.0)
                    put("odometer", 630.0)
                    put("source", "app")
                    put("fillState", "unknown")
                    put("economyStatus", "unknown-fill")
                })
            }

            activity.renderFuel(stats, logsJson, fleet = false)

            val avgView = activity.findViewById<TextView>(R.id.statAvgEconomy)
            val summaryView = activity.findViewById<TextView>(R.id.statEconomyRange)
            assertEquals("14.25", avgView.text.toString())
            assertTrue(summaryView.text.toString().contains("1 full-tank cycles"))

            val listContainer = activity.findViewById<LinearLayout>(R.id.fuelLogContainer)
            assertEquals(3, listContainer.childCount)

            val row1Text = (listContainer.getChildAt(0) as LinearLayout).getChildAt(1) as TextView
            assertTrue(row1Text.text.toString().contains("14.25 km/L over 570 km / 40.0 L"))
            assertTrue(row1Text.text.toString().contains("Full tank"))

            val row2Text = (listContainer.getChildAt(1) as LinearLayout).getChildAt(1) as TextView
            assertTrue(row2Text.text.toString().contains("Partial fill · awaiting full fill"))
            assertTrue(row2Text.text.toString().contains("Partial fill"))

            val row3Text = (listContainer.getChildAt(2) as LinearLayout).getChildAt(1) as TextView
            assertTrue(row3Text.text.toString().contains("Unclassified fill · economy unavailable"))
            assertTrue(row3Text.text.toString().contains("Unclassified fill"))
        } finally {
            controller.pause().stop().destroy()
        }
    }

    @Test
    fun fuelActivityRendersFleetNoticeWhenAllVehiclesSelected() {
        val controller = Robolectric.buildActivity(FuelActivity::class.java).setup()
        try {
            val activity = controller.get()
            val stats = JSONObject().apply {
                put("averageKmPerLitre", 14.25)
                put("cycleCount", 2)
            }
            activity.renderFuel(stats, JSONArray(), fleet = true)

            val avgView = activity.findViewById<TextView>(R.id.statAvgEconomy)
            val summaryView = activity.findViewById<TextView>(R.id.statEconomyRange)
            assertEquals("N/A", avgView.text.toString())
            assertEquals("Select one vehicle for fuel economy", summaryView.text.toString())
        } finally {
            controller.pause().stop().destroy()
        }
    }

    @Test
    fun diagnosticsActivityRendersNeverPolledState() {
        val controller = Robolectric.buildActivity(DiagnosticsActivity::class.java).setup()
        try {
            val activity = controller.get()
            val json = JSONObject().apply {
                put("latest", JSONObject().apply {
                    put("latestDtc", JSONObject().apply {
                        put("code", "")
                        put("timestamp", JSONObject.NULL)
                    })
                })
            }
            activity.renderDiagnostics(json, emptyList())

            val statusView = activity.findViewById<TextView>(R.id.tvLatestPoll)
            assertTrue(statusView.text.toString().contains("Never polled (Unconfirmed)"))

            val dtcContainer = activity.findViewById<LinearLayout>(R.id.dtcListContainer)
            assertEquals(1, dtcContainer.childCount)
            val line = dtcContainer.getChildAt(0) as TextView
            assertTrue(line.text.toString().contains("No confirmed scan result"))
        } finally {
            controller.pause().stop().destroy()
        }
    }

    @Test
    fun diagnosticsActivityRendersConfirmedEmptyScan() {
        val controller = Robolectric.buildActivity(DiagnosticsActivity::class.java).setup()
        try {
            val activity = controller.get()
            val json = JSONObject().apply {
                put("latest", JSONObject().apply {
                    put("latestDtc", JSONObject().apply {
                        put("code", "No trouble codes found")
                        put("timestamp", 1700000000000L)
                    })
                    put("latestReadStatus", JSONObject().apply {
                        put("success", true)
                        put("timestamp", 1700000000000L)
                    })
                })
            }
            activity.renderDiagnostics(json, emptyList())

            val statusView = activity.findViewById<TextView>(R.id.tvLatestPoll)
            assertTrue(statusView.text.toString().contains("Successful"))

            val dtcContainer = activity.findViewById<LinearLayout>(R.id.dtcListContainer)
            assertEquals(1, dtcContainer.childCount)
            val line = dtcContainer.getChildAt(0) as TextView
            assertTrue(line.text.toString().contains("No fault codes detected in the last successful scan"))
        } finally {
            controller.pause().stop().destroy()
        }
    }

    @Test
    fun diagnosticsActivityRendersHexCodesWithSeverities() {
        val controller = Robolectric.buildActivity(DiagnosticsActivity::class.java).setup()
        try {
            val activity = controller.get()
            val json = JSONObject().apply {
                put("latest", JSONObject().apply {
                    put("latestDtc", JSONObject().apply {
                        put("code", "P012A, U1900")
                        put("timestamp", 1700000000000L)
                    })
                    put("latestReadStatus", JSONObject().apply {
                        put("success", true)
                        put("timestamp", 1700000000000L)
                    })
                })
            }
            val details = listOf(
                JSONObject().apply {
                    put("code", "P012A")
                    put("description", "Turbocharger/Supercharger Inlet Pressure Sensor")
                    put("severity", "moderate")
                    put("system", "Air/Fuel")
                },
                JSONObject().apply {
                    put("code", "U1900")
                    put("description", "CAN Communication Bus Fault")
                    put("severity", "warning")
                    put("system", "Network")
                }
            )
            activity.renderDiagnostics(json, details)

            val statusView = activity.findViewById<TextView>(R.id.tvLatestPoll)
            assertTrue(statusView.text.toString().contains("Successful"))

            val dtcContainer = activity.findViewById<LinearLayout>(R.id.dtcListContainer)
            // Each code adds 2 views: header (badge + system) and desc
            assertEquals(4, dtcContainer.childCount)
            val header1 = dtcContainer.getChildAt(0) as LinearLayout
            val badge1 = header1.getChildAt(0) as TextView
            assertEquals("P012A", badge1.text.toString())

            val header2 = dtcContainer.getChildAt(2) as LinearLayout
            val badge2 = header2.getChildAt(0) as TextView
            assertEquals("U1900", badge2.text.toString())
        } finally {
            controller.pause().stop().destroy()
        }
    }

    @Test
    fun diagnosticsActivityRendersFailedScanWithHistoricalCodes() {
        val controller = Robolectric.buildActivity(DiagnosticsActivity::class.java).setup()
        try {
            val activity = controller.get()
            val json = JSONObject().apply {
                put("latest", JSONObject().apply {
                    // Prior confirmed code at t=1000
                    put("latestDtc", JSONObject().apply {
                        put("code", "P012A")
                        put("timestamp", 1700000001000L)
                    })
                    // Latest read failed at t=2000
                    put("latestReadStatus", JSONObject().apply {
                        put("success", false)
                        put("timestamp", 1700000002000L)
                        put("error", "ELM327 interface communication error")
                    })
                })
            }
            activity.renderDiagnostics(json, emptyList())

            val statusView = activity.findViewById<TextView>(R.id.tvLatestPoll)
            assertTrue(statusView.text.toString().contains("Failed"))

            val dtcContainer = activity.findViewById<LinearLayout>(R.id.dtcListContainer)
            var foundFailedNotice = false
            var foundHistoricalNotice = false
            for (i in 0 until dtcContainer.childCount) {
                val child = dtcContainer.getChildAt(i)
                if (child is TextView) {
                    val text = child.text.toString()
                    if (text.contains("Latest scan failed; current fault status is unknown.")) foundFailedNotice = true
                    if (text.contains("Previous successful scan result (historical):")) foundHistoricalNotice = true
                }
            }
            assertTrue("Expected failed scan notice", foundFailedNotice)
            assertTrue("Expected historical fallback notice", foundHistoricalNotice)
        } finally {
            controller.pause().stop().destroy()
        }
    }

    @Test
    fun dtcLookupRequestBodyFormatsCodesObject() {
        val codes = listOf("P012A", "U1900")
        val payload = JSONObject().put("codes", JSONArray(codes)).toString()
        val parsed = JSONObject(payload)
        assertTrue(parsed.has("codes"))
        val arr = parsed.getJSONArray("codes")
        assertEquals(2, arr.length())
        assertEquals("P012A", arr.getString(0))
        assertEquals("U1900", arr.getString(1))
    }
}
