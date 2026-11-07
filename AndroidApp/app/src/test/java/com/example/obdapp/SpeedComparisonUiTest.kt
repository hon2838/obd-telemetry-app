package com.example.obdapp

import android.content.BroadcastReceiver
import android.content.Intent
import android.os.SystemClock
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class SpeedComparisonUiTest {
    @Test fun separateGpsSpeedIsShownInsteadOfEchoingTheSelectedVehicleSpeed() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val locale = Locale.getDefault()
        Locale.setDefault(Locale.US)
        try {
            val a = controller.get()
            val receiver = ReflectionHelpers.getField<BroadcastReceiver>(a, "telemetryReceiver")
            val slot = a.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
            val row = slot.findViewById<TextView>(R.id.speedComparisonRow)
            val now = SystemClock.elapsedRealtime()
            val intent = Intent("com.example.obdapp.TELEMETRY_UPDATE")
                .putExtra("vehicle_id", VehiclePrefs.getActiveVehicleId(a))
                .putExtra("timestamp", System.currentTimeMillis())
                .putExtra("speed", 80f).putExtra("speed_source", "OBD")
                .putExtra("obd_status", "Connected")
                .putExtra("obd_speed_kmh", 80f).putExtra("obd_speed_at_elapsed_ms", now)
                .putExtra("gps_speed_kmh", 78f).putExtra("gps_speed_at_elapsed_ms", now)
            receiver.onReceive(a, intent)
            assertEquals("GPS 78.0 km/h · OBD−GPS +2.0 km/h", row.text.toString())
            assertEquals("78.0 km/h (GPS)", a.findViewById<TextView>(R.id.tvGpsSpeed).text.toString())
            assertEquals("OBD SPEED", slot.findViewById<CircularGaugeView>(R.id.dialGaugeView).title)
            receiver.onReceive(a, Intent("com.example.obdapp.STATUS_UPDATE").putExtra("running", false))
            assertEquals("GPS — km/h · OBD−GPS — km/h", row.text.toString())
            assertEquals("N/A", a.findViewById<TextView>(R.id.tvGpsSpeed).text.toString())
        } finally {
            Locale.setDefault(locale)
            controller.pause().stop().destroy()
        }
    }

    @Test fun selectedGpsFallbackIsNeverSubtractedFromItself() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val locale = Locale.getDefault()
        Locale.setDefault(Locale.US)
        try {
            val a = controller.get()
            val receiver = ReflectionHelpers.getField<BroadcastReceiver>(a, "telemetryReceiver")
            val slot = a.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
            receiver.onReceive(a, Intent("com.example.obdapp.TELEMETRY_UPDATE")
                .putExtra("vehicle_id", VehiclePrefs.getActiveVehicleId(a))
                .putExtra("timestamp", System.currentTimeMillis())
                .putExtra("speed", 78f).putExtra("speed_source", "GPS")
                .putExtra("obd_status", "GPS Only")
                .putExtra("gps_speed_kmh", 78f)
                .putExtra("gps_speed_at_elapsed_ms", SystemClock.elapsedRealtime()))
            assertEquals("GPS 78.0 km/h · OBD−GPS — km/h",
                slot.findViewById<TextView>(R.id.speedComparisonRow).text.toString())
            assertEquals("GPS SPEED", slot.findViewById<CircularGaugeView>(R.id.dialGaugeView).title)
        } finally {
            Locale.setDefault(locale)
            controller.pause().stop().destroy()
        }
    }
}
