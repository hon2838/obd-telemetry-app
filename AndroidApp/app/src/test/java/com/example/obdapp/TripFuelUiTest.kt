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
class TripFuelUiTest {
    @Test fun onlyTrustedFreshMatchingVehicleTotalsPopulateTheRow() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val a = controller.get()
            val id = VehiclePrefs.getActiveVehicleId(a)
            val receiver = ReflectionHelpers.getField<BroadcastReceiver>(a, "telemetryReceiver")
            val mock = ReflectionHelpers.getField<BroadcastReceiver>(a, "mockTelemetryReceiver")
            val slot = a.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
            val readout = slot.findViewById<TextView>(R.id.tvThrottleTripFuel)
            fun sample(vehicle: String = id, age: Long = 0, trusted: Boolean = true, tripAge: Long = 0,
                       economy: Double = 18.2) {
                (if (trusted) receiver else mock).onReceive(a, Intent("com.example.obdapp.TELEMETRY_UPDATE")
                    .putExtra("vehicle_id", vehicle).putExtra("timestamp", System.currentTimeMillis() - age)
                    .putExtra("obd_status", "Connected").putExtra("speed_source", "OBD")
                    .putExtra("speed", 60f).putExtra("rpm", 2400).putExtra("throttle", 10)
                    .putExtra("trip_fuel_economy_kml", economy).putExtra("trip_fuel_coverage_ratio", 0.85)
                    .putExtra("trip_fuel_at_elapsed_ms", SystemClock.elapsedRealtime() - tripAge))
            }
            sample()
            assertEquals("18.2", readout.text.toString())
            assertEquals("Est. · 85% sampled", slot.findViewById<TextView>(R.id.tvTripFuelQuality).text.toString())
            ShadowSystemClock.advanceBy(Duration.ofSeconds(1))
            sample(economy = 20.0)
            sample(economy = 3.0, tripAge = 500)
            assertEquals("20.0", readout.text.toString())
            sample()
            sample(vehicle = "another-car"); assertEquals("—", readout.text.toString())
            sample(age = 6000); assertEquals("18.2", readout.text.toString())
            sample(tripAge = TripFuelAccumulator.TRIP_GAP_MS + 1); assertEquals("18.2", readout.text.toString())
            sample(trusted = false); assertEquals("—", readout.text.toString())
            sample(tripAge = TripFuelAccumulator.TRIP_GAP_MS + 1); assertEquals("—", readout.text.toString())
            sample()
            receiver.onReceive(a, Intent("com.example.obdapp.STATUS_UPDATE").putExtra("running", false))
            assertEquals("18.2", readout.text.toString())
            assertTrue(slot.findViewById<TextView>(R.id.tvTripFuelQuality).text.startsWith("Paused"))
            ShadowSystemClock.advanceBy(Duration.ofMillis(TripFuelAccumulator.TRIP_GAP_MS + 1))
            ReflectionHelpers.callInstanceMethod<Unit>(a, "updateTelemetryAge")
            assertEquals("—", readout.text.toString())
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun tripRowIsVisibleWithoutOptInAndFitsBetweenThrottleAndInstantEconomy() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val widget = TelemetryWidgetView(context)
        widget.bindMetric(TelemetryMetric.THROTTLE, DisplayStyle.BAR)
        widget.updateTripFuelEconomy(18.2, 0.85)
        val density = context.resources.displayMetrics.density
        val w = (382 * density).toInt(); val h = (368 * density).toInt()
        widget.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        widget.layout(0, 0, w, h)
        val row = widget.findViewById<View>(R.id.throttleTripFuelRow)
        val primary = widget.findViewById<View>(R.id.telemetryPrimaryContent)
        val supplemental = widget.findViewById<View>(R.id.throttleSupplementalRows)
        assertEquals(View.VISIBLE, row.visibility)
        assertTrue(row.height > 0)
        assertTrue(supplemental.bottom <= primary.height)
        assertTrue(supplemental.top + row.top > 100 * density)
        widget.bindMetric(TelemetryMetric.RPM, DisplayStyle.DIAL)
        assertEquals(View.GONE, row.visibility)
    }

    @Test fun malformedTripValuesRenderUnavailableInsteadOfNaNOrInfinity() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val widget = TelemetryWidgetView(context)
        widget.updateTripFuelEconomy(Double.NaN, Double.NaN)
        assertEquals("—", widget.findViewById<TextView>(R.id.tvThrottleTripFuel).text.toString())
        assertEquals("Waiting for fuel data", widget.findViewById<TextView>(R.id.tvTripFuelQuality).text.toString())
    }
}
