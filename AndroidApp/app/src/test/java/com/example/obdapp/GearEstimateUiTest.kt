package com.example.obdapp

import android.content.BroadcastReceiver
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock
import org.robolectric.util.ReflectionHelpers
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class GearEstimateUiTest {
    @Test fun gearProfileDefaultsOffAndIsScopedToOneVehicle() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertFalse(GearEstimatePrefs.enabled(context, "car-a"))
        GearEstimatePrefs.setEnabled(context, "car-a", true)
        assertTrue(GearEstimatePrefs.enabled(context, "car-a"))
        assertFalse(GearEstimatePrefs.enabled(context, "car-b"))
    }

    @Test fun onlyFreshMatchingObdSamplesCanPopulateTheGearReadout() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val a = controller.get()
            val id = VehiclePrefs.getActiveVehicleId(a)
            GearEstimatePrefs.setEnabled(a, id, true)
            val receiver = ReflectionHelpers.getField<BroadcastReceiver>(a, "telemetryReceiver")
            val slot = a.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
            val readout = slot.findViewById<TextView>(R.id.tvThrottleGear)
            fun sample(source: String = "OBD", vehicle: String = id, age: Long = 0) {
                receiver.onReceive(a, Intent("com.example.obdapp.TELEMETRY_UPDATE")
                    .putExtra("vehicle_id", vehicle).putExtra("timestamp", System.currentTimeMillis() - age)
                    .putExtra("obd_status", "Connected").putExtra("speed_source", source)
                    .putExtra("speed", 80f).putExtra("rpm", 2400).putExtra("throttle", 10))
            }
            repeat(3) { sample(); ShadowSystemClock.advanceBy(Duration.ofMillis(500)) }
            assertEquals("4", readout.text.toString())
            sample(source = "GPS")
            assertEquals("—", readout.text.toString())
            repeat(3) { sample(); ShadowSystemClock.advanceBy(Duration.ofMillis(500)) }
            sample(vehicle = "another-car")
            assertEquals("—", readout.text.toString())
            repeat(3) { sample(); ShadowSystemClock.advanceBy(Duration.ofMillis(500)) }
            sample(age = 6000)
            assertEquals("—", readout.text.toString())
            repeat(3) { sample(); ShadowSystemClock.advanceBy(Duration.ofMillis(500)) }
            receiver.onReceive(a, Intent("com.example.obdapp.STATUS_UPDATE").putExtra("running", false))
            assertEquals("—", readout.text.toString())
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun gearRowFitsInTheExistingThrottleSpaceOnFirstLayout() {
        val c = ApplicationProvider.getApplicationContext<android.content.Context>()
        val widget = TelemetryWidgetView(c)
        widget.bindMetric(TelemetryMetric.THROTTLE, DisplayStyle.BAR)
        widget.updateGearEstimate(3, true)
        val density = c.resources.displayMetrics.density
        val w = (382 * density).toInt()
        val h = (368 * density).toInt()
        widget.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        widget.layout(0, 0, w, h)
        val row = widget.findViewById<View>(R.id.throttleGearRow)
        val primary = widget.findViewById<View>(R.id.telemetryPrimaryContent)
        val supplemental = widget.findViewById<View>(R.id.throttleSupplementalRows)
        assertEquals(View.VISIBLE, row.visibility)
        assertTrue(row.height > 0)
        assertTrue(supplemental.bottom <= primary.height)
        // The gear is now nested in the supplemental stack; compare in primary-content coordinates.
        assertTrue(supplemental.top + row.top > 100 * density)
        widget.updateGearEstimate(null, false)
        assertEquals(View.GONE, row.visibility)
    }
}
