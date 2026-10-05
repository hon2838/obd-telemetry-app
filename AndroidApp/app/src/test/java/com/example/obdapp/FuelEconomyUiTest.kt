package com.example.obdapp

import android.content.BroadcastReceiver
import android.content.Intent
import android.widget.TextView
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
class FuelEconomyUiTest {
    @Test @Config(sdk = [29], qualifiers = "w320dp-h640dp")
    fun fuelReadoutWrapsWithoutClippingOnNarrowScreens() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val activity = controller.get()
            val receiver = ReflectionHelpers.getField<BroadcastReceiver>(activity, "telemetryReceiver")
            receiver.onReceive(activity, Intent("com.example.obdapp.TELEMETRY_UPDATE")
                .putExtra("timestamp", System.currentTimeMillis())
                .putExtra("obd_status", "Connected")
                .putExtra("estimated_fuel_economy_kml", 12.5))
            val root = activity.findViewById<android.view.View>(android.R.id.content)
            val density = activity.resources.displayMetrics.density
            root.measure(
                android.view.View.MeasureSpec.makeMeasureSpec((320 * density).toInt(), android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec((640 * density).toInt(), android.view.View.MeasureSpec.EXACTLY))
            root.layout(0, 0, root.measuredWidth, root.measuredHeight)
            val view = activity.findViewById<TextView>(R.id.tvFuelEconomy)
            assertTrue(view.width > 0)
            assertTrue(view.layout.lineCount >= 3)
            assertTrue(view.height >= view.layout.getLineBottom(view.layout.lineCount - 1) +
                view.compoundPaddingTop + view.compoundPaddingBottom)
            for (line in 0 until view.layout.lineCount) {
                assertTrue(view.layout.getLineMax(line) <= view.width - view.compoundPaddingLeft - view.compoundPaddingRight)
            }
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun idleZeroAndUnavailableInputsRenderInTheRealActivity() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val activity = controller.get()
            val receiver = ReflectionHelpers.getField<BroadcastReceiver>(activity, "telemetryReceiver")
            val view = activity.findViewById<TextView>(R.id.tvFuelEconomy)
            val originalLocale = java.util.Locale.getDefault()
            java.util.Locale.setDefault(java.util.Locale.US)
            fun send(value: Double?) {
                val intent = Intent("com.example.obdapp.TELEMETRY_UPDATE")
                    .putExtra("timestamp", System.currentTimeMillis())
                    .putExtra("obd_status", "Connected")
                    .putExtra("estimated_fuel_rate_lph", 1.06)
                if (value != null) intent.putExtra("estimated_fuel_economy_kml", value)
                receiver.onReceive(activity, intent)
            }
            try {
                send(0.0)
                assertEquals("0.0 km/L\nEstimated fuel rate: 1.1 L/h", view.text.toString())
                for (value in listOf(null, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
                    send(value)
                    assertEquals("N/A\nEstimated fuel rate: 1.1 L/h\nEstimate unavailable or incomplete",
                        view.text.toString())
                }
            } finally { java.util.Locale.setDefault(originalLocale) }
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun staleTelemetryAndStoppedCollectorClearTheDisplayedEstimate() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val activity = controller.get()
            val receiver = ReflectionHelpers.getField<BroadcastReceiver>(activity, "telemetryReceiver")
            val view = activity.findViewById<TextView>(R.id.tvFuelEconomy)
            fun send(ageMs: Long) = receiver.onReceive(activity,
                Intent("com.example.obdapp.TELEMETRY_UPDATE")
                    .putExtra("timestamp", System.currentTimeMillis() - ageMs)
                    .putExtra("obd_status", "Connected")
                    .putExtra("estimated_fuel_rate_lph", 1.06)
                    .putExtra("estimated_fuel_economy_kml", 12.5))
            send(0)
            assertTrue(view.text.toString().contains("km/L"))
            assertTrue(view.text.toString().contains("L/h"))
            ReflectionHelpers.setField(activity, "lastTelemetryAt", System.currentTimeMillis() - 6000)
            ReflectionHelpers.callInstanceMethod<Any?>(activity, "updateTelemetryAge")
            assertEquals("N/A · Reading too old", view.text.toString())
            send(6000)
            assertEquals("N/A · Reading too old", view.text.toString())
            send(-6000)
            assertEquals("N/A · Awaiting fresh reading", view.text.toString())
            send(0)
            receiver.onReceive(activity, Intent("com.example.obdapp.STATUS_UPDATE").putExtra("running", false))
            assertEquals("N/A · Disconnected", view.text.toString())
            ReflectionHelpers.callInstanceMethod<Any?>(activity, "updateTelemetryAge")
            assertEquals("N/A · Disconnected", view.text.toString())
            send(0)
            receiver.onReceive(activity, Intent("com.example.obdapp.STATUS_UPDATE")
                .putExtra("running", true).putExtra("status", "OBD: Connection Lost — GPS Only"))
            assertEquals("N/A · Disconnected", view.text.toString())
        } finally { controller.pause().stop().destroy() }
    }
}
