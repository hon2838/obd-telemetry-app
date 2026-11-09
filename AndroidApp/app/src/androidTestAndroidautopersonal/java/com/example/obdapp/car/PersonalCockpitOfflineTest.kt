package com.example.obdapp.car

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.net.ConnectivityManager
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.obdapp.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Bitmap/real-View validation only. Never starts a collector or injects telemetry broadcasts. */
@RunWith(AndroidJUnit4::class)
class PersonalCockpitOfflineTest {
    private lateinit var context: Context

    @Before fun requireOfflineEmulator() {
        assumeTrue("Synthetic cockpit data is emulator-only", Build.HARDWARE in listOf("ranchu", "goldfish"))
        context = ApplicationProvider.getApplicationContext()
        assertNull("Disable emulator Wi-Fi and mobile data before this suite",
            (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).activeNetwork)
        assertFalse(OBDGatewayService.isRunning)
    }

    private fun snapshot(now: Long) = LiveGaugeSnapshot(speedKmh = 80f, speedSource = "OBD", rpm = 2400,
        coolantTemp = 86, voltage = 13.9f, fuelRateLph = 4.32, fuelEconomyKmL = 18.5,
        engineLoad = 25, throttlePos = 10, intakeAirTemp = 36, sampledAtElapsedMs = now,
        obdSpeedKmh = 80f, obdSpeedAtElapsedMs = now, gpsSpeedKmh = 78f, gpsSpeedAtElapsedMs = now - 250,
        tripEconomyKmL = 18.2, tripCoverageRatio = 0.85, tripSampledAtElapsedMs = now)

    private fun status(snapshot: LiveGaugeSnapshot) = GatewayStatus(running = true, vehicleId = "emulator-car",
        adapterConnected = true, sampledAtElapsedMs = snapshot.sampledAtElapsedMs, liveGauges = snapshot)

    private fun onMain(work: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(work)

    @Test fun fullCockpitShowsTripAndGpsComparisonInRealAndroidViews() = onMain {
        val now = SystemClock.elapsedRealtime()
        val bitmap = Bitmap.createBitmap(1280, 720, Bitmap.Config.ARGB_8888)
        val renderer = PersonalCockpitRenderer(context)
        try {
            renderer.draw(Canvas(bitmap), Rect(0, 0, 1280, 720), 160, status(snapshot(now)), "emulator-car", now)
            val root = renderer.rootView!!
            val speed = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
            val rpm = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot1)
            val throttle = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
            assertEquals(80f, speed.findViewById<CircularGaugeView>(R.id.dialGaugeView).currentValue)
            assertEquals(2400f, rpm.findViewById<CircularGaugeView>(R.id.dialGaugeView).currentValue)
            assertEquals("GPS 78.0 km/h · OBD−GPS +2.0 km/h", speed.findViewById<TextView>(R.id.speedComparisonRow).text.toString())
            assertEquals("18.2", throttle.findViewById<TextView>(R.id.tvThrottleTripFuel).text.toString())
            assertEquals("18.5", throttle.findViewById<TextView>(R.id.tvThrottleFuelEconomy).text.toString())
            assertEquals("4.3", throttle.findViewById<TextView>(R.id.tvThrottleFuelRate).text.toString())
            assertEquals(View.VISIBLE, throttle.findViewById<View>(R.id.throttleTripFuelRow).visibility)
            save(bitmap, "personal-full-cockpit-simulated")
        } finally { bitmap.recycle() }
    }

    @Test fun occlusionIsClippedAndOldDataBecomesUnavailableWithPausedTrip() = onMain {
        val now = SystemClock.elapsedRealtime()
        val bitmap = Bitmap.createBitmap(1280, 720, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.MAGENTA)
        val renderer = PersonalCockpitRenderer(context)
        val viewport = Rect(70, 50, 1210, 680)
        try {
            renderer.draw(Canvas(bitmap), viewport, 160, status(snapshot(now)), "emulator-car", now)
            assertEquals(Color.MAGENTA, bitmap.getPixel(0, 0))
            assertEquals(Color.MAGENTA, bitmap.getPixel(69, 49))
            assertEquals(Color.MAGENTA, bitmap.getPixel(1211, 681))
            assertNotEquals(Color.MAGENTA, bitmap.getPixel(100, 100))
            renderer.draw(Canvas(bitmap), viewport, 160, status(snapshot(now)), "emulator-car", now + 6000)
            val root = renderer.rootView!!
            assertFalse(root.findViewById<TelemetryWidgetView>(R.id.widgetSlot0).isMetricAvailable)
            assertFalse(root.findViewById<TelemetryWidgetView>(R.id.widgetSlot1).isMetricAvailable)
            val throttle = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
            assertEquals("18.2", throttle.findViewById<TextView>(R.id.tvThrottleTripFuel).text.toString())
            assertTrue(throttle.findViewById<TextView>(R.id.tvTripFuelQuality).text.startsWith("Paused"))
            save(bitmap, "personal-cockpit-occluded-stale-simulated")
        } finally { bitmap.recycle() }
    }

    @Test fun gpsFallbackHasItsOwnTitleAndNoFalseZeroDifference() = onMain {
        val now = SystemClock.elapsedRealtime()
        val bitmap = Bitmap.createBitmap(1280, 720, Bitmap.Config.ARGB_8888)
        val renderer = PersonalCockpitRenderer(context)
        try {
            val gps = snapshot(now).copy(speedKmh = 78f, speedSource = "GPS", obdSpeedKmh = null, obdSpeedAtElapsedMs = null,
                rpm = null, throttlePos = null, fuelRateLph = null, fuelEconomyKmL = null)
            renderer.draw(Canvas(bitmap), Rect(0, 0, 1280, 720), 160, status(gps).copy(adapterConnected = false), "emulator-car", now)
            val speed = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
            assertEquals("GPS SPEED", speed.findViewById<CircularGaugeView>(R.id.dialGaugeView).title)
            assertEquals("GPS 78.0 km/h · OBD−GPS — km/h", speed.findViewById<TextView>(R.id.speedComparisonRow).text.toString())
            save(bitmap, "personal-cockpit-gps-fallback-simulated")
        } finally { bitmap.recycle() }
    }

    @Test fun compactAndDenseHostsKeepAllPrimaryGaugesInsideTheirCards() = onMain {
        val now = SystemClock.elapsedRealtime()
        for ((width, height, dpi) in listOf(Triple(800, 480, 160), Triple(1280, 720, 240))) {
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val renderer = PersonalCockpitRenderer(context)
            try {
                renderer.draw(Canvas(bitmap), Rect(0, 0, width, height), dpi, status(snapshot(now)), "emulator-car", now)
                val root = renderer.rootView!!
                for (id in listOf(R.id.widgetSlot0, R.id.widgetSlot1, R.id.widgetSlot2,
                    R.id.widgetSlot3, R.id.widgetSlot4, R.id.widgetSlot5)) {
                    val widget = root.findViewById<TelemetryWidgetView>(id)
                    val bounds = Rect()
                    widget.getDrawingRect(bounds)
                    (root as android.view.ViewGroup).offsetDescendantRectToMyCoords(widget, bounds)
                    assertTrue(widget.isMetricAvailable)
                    assertTrue("Gauge must fit host viewport: $bounds", Rect(0, 0, width, height).contains(bounds))
                }
                save(bitmap, "personal-cockpit-${width}x${height}-${dpi}dpi-simulated")
            } finally { bitmap.recycle() }
        }
    }

    private fun save(bitmap: Bitmap, name: String) {
        File(context.filesDir, "$name.png").outputStream().use {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
    }
}
