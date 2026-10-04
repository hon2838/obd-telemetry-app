package com.example.obdapp

import android.content.BroadcastReceiver
import android.content.Intent
import android.widget.TextView
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class FuelEconomyUiTest {
    @Test fun idleZeroAndUnavailableInputsRenderInTheRealActivity() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val activity = controller.get()
            val receiver = ReflectionHelpers.getField<BroadcastReceiver>(activity, "telemetryReceiver")
            val view = activity.findViewById<TextView>(R.id.tvFuelEconomy)
            fun send(value: Double?) {
                val intent = Intent("com.example.obdapp.TELEMETRY_UPDATE")
                    .putExtra("timestamp", System.currentTimeMillis())
                if (value != null) intent.putExtra("estimated_fuel_economy_kml", value)
                receiver.onReceive(activity, intent)
            }
            send(0.0)
            assertEquals("0.0 km/L", view.text.toString())
            for (value in listOf(null, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
                send(value)
                assertEquals("N/A", view.text.toString())
            }
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
                    .putExtra("estimated_fuel_economy_kml", 12.5))
            send(0)
            assertEquals("12.5 km/L", view.text.toString())
            ReflectionHelpers.setField(activity, "lastTelemetryAt", System.currentTimeMillis() - 6000)
            ReflectionHelpers.callInstanceMethod<Any?>(activity, "updateTelemetryAge")
            assertEquals("N/A", view.text.toString())
            send(6000)
            assertEquals("N/A", view.text.toString())
            send(0)
            receiver.onReceive(activity, Intent("com.example.obdapp.STATUS_UPDATE").putExtra("running", false))
            assertEquals("N/A", view.text.toString())
        } finally { controller.pause().stop().destroy() }
    }
}
