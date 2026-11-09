package com.example.obdapp.car

import android.content.Context
import android.graphics.Canvas
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageButton
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import com.example.obdapp.CircularGaugeView
import com.example.obdapp.DisplayStyle
import com.example.obdapp.GatewayStatus
import com.example.obdapp.LiveGaugeSnapshot
import com.example.obdapp.R
import com.example.obdapp.TelemetryMetric
import com.example.obdapp.TelemetryWidgetView
import com.example.obdapp.TripFuelAccumulator
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class PersonalCockpitRendererTest {

    private lateinit var context: Context
    private lateinit var renderer: PersonalCockpitRenderer
    private val canvas = Canvas()
    private lateinit var previousLocale: Locale

    @Before
    fun setUp() {
        previousLocale = Locale.getDefault()
        Locale.setDefault(Locale.US)
        context = ApplicationProvider.getApplicationContext()
        renderer = PersonalCockpitRenderer(context)
    }

    @After fun restoreLocale() { Locale.setDefault(previousLocale) }

    @Test
    fun freshWrapperCannotRestampMissingOrExpiredSensorClocks() {
        val viewport = Rect(0, 0, 1280, 720)
        val snapshot = LiveGaugeSnapshot(sampledAtElapsedMs = 10_000L, rpm = 2200,
            obdSpeedKmh = 80f, obdSpeedAtElapsedMs = 8_000L,
            gpsSpeedKmh = 78f, gpsSpeedAtElapsedMs = 9_900L)
        val status = GatewayStatus(running = true, vehicleId = "car-alpha", adapterConnected = true,
            sampledAtElapsedMs = 10_000L, liveGauges = snapshot)
        renderer.draw(canvas, viewport, 160, status, "car-alpha", 10_100L)
        val root = renderer.rootView!!
        val speed = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
        assertEquals(78f, speed.findViewById<CircularGaugeView>(R.id.dialGaugeView).currentValue)
        assertEquals("GPS SPEED", speed.findViewById<CircularGaugeView>(R.id.dialGaugeView).title)
        assertTrue(root.findViewById<TelemetryWidgetView>(R.id.widgetSlot1).isMetricAvailable)

        renderer.draw(canvas, viewport, 160, status.copy(liveGauges = snapshot.copy(
            sampledAtElapsedMs = -1L, obdSpeedAtElapsedMs = null, gpsSpeedAtElapsedMs = null)),
            "car-alpha", 10_100L)
        assertFalse(speed.isMetricAvailable)
        assertFalse(root.findViewById<TelemetryWidgetView>(R.id.widgetSlot1).isMetricAvailable)
    }

    @Test
    fun olderOrUntimedTripCannotReplaceTheLastValidTrip() {
        val viewport = Rect(0, 0, 1280, 720)
        val snapshot = LiveGaugeSnapshot(sampledAtElapsedMs = 10_000L,
            tripEconomyKmL = 18.2, tripCoverageRatio = 0.85, tripSampledAtElapsedMs = 10_000L)
        val status = GatewayStatus(running = true, vehicleId = "car-alpha", adapterConnected = true,
            sampledAtElapsedMs = 10_000L, liveGauges = snapshot)
        renderer.draw(canvas, viewport, 160, status, "car-alpha", 10_100L)
        val throttle = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
        val readout = throttle.findViewById<TextView>(R.id.tvThrottleTripFuel)
        renderer.draw(canvas, viewport, 160, status.copy(liveGauges = snapshot.copy(
            tripEconomyKmL = 30.0, tripSampledAtElapsedMs = 9_000L)), "car-alpha", 10_200L)
        assertEquals("18.2", readout.text.toString())
        renderer.draw(canvas, viewport, 160, status.copy(liveGauges = snapshot.copy(
            sampledAtElapsedMs = 16_000L, tripEconomyKmL = 40.0, tripSampledAtElapsedMs = null)),
            "car-alpha", 16_100L)
        assertEquals("18.2", readout.text.toString())
        assertTrue(throttle.findViewById<TextView>(R.id.tvTripFuelQuality).text.startsWith("Paused"))
    }

    @Test
    fun viewportAndLayoutBoundsConfiguredWithoutControls() {
        val viewport = Rect(0, 0, 1024, 600)
        val status = GatewayStatus(
            running = true,
            vehicleId = "car-alpha",
            adapterConnected = true,
            sampledAtElapsedMs = 10_000L,
            liveGauges = LiveGaugeSnapshot(sampledAtElapsedMs = 10_000L)
        )

        renderer.draw(canvas, viewport, dpi = 160, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 10_500L)

        val root = renderer.rootView
        assertNotNull("rootView must be non-null after draw", root)
        assertEquals(1024, root?.width)
        assertEquals(600, root?.height)

        // Verify read-only: no buttons, no image buttons, no mutation controls
        assertNoControls(root!!)

        // Verify all 6 slots in the canonical cockpit order
        val slot0 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
        val slot1 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot1)
        val slot2 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
        val slot3 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot3)
        val slot4 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot4)
        val slot5 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot5)

        assertNotNull("Slot 0 (Speed) must exist", slot0)
        assertNotNull("Slot 1 (RPM) must exist", slot1)
        assertNotNull("Slot 2 (Throttle) must exist", slot2)
        assertNotNull("Slot 3 (Engine Load) must exist", slot3)
        assertNotNull("Slot 4 (Coolant) must exist", slot4)
        assertNotNull("Slot 5 (Intake Temp) must exist", slot5)

        assertEquals(TelemetryMetric.SPEED, slot0.currentMetric)
        assertEquals(DisplayStyle.DIAL, slot0.currentStyle)

        assertEquals(TelemetryMetric.RPM, slot1.currentMetric)
        assertEquals(DisplayStyle.DIAL, slot1.currentStyle)

        assertEquals(TelemetryMetric.THROTTLE, slot2.currentMetric)
        assertEquals(DisplayStyle.BAR, slot2.currentStyle)

        assertEquals(TelemetryMetric.ENGINE_LOAD, slot3.currentMetric)
        assertEquals(DisplayStyle.BAR, slot3.currentStyle)

        assertEquals(TelemetryMetric.COOLANT, slot4.currentMetric)
        assertEquals(DisplayStyle.BAR, slot4.currentStyle)

        assertEquals(TelemetryMetric.INTAKE_TEMP, slot5.currentMetric)
        assertEquals(DisplayStyle.BAR, slot5.currentStyle)

        assertTrue(slot0.width > 0 && slot0.height > 0)
        assertTrue(slot1.width > 0 && slot1.height > 0)
        assertTrue(slot2.width > 0 && slot2.height > 0)

        // Translated viewport test (e.g. system inset bars)
        val translatedViewport = Rect(50, 100, 850, 700)
        renderer.draw(canvas, translatedViewport, dpi = 160, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 10_600L)

        val translatedRoot = renderer.rootView
        assertNotNull(translatedRoot)
        assertEquals(800, translatedRoot?.width)
        assertEquals(600, translatedRoot?.height)
    }

    @Test
    fun portraitLayoutAdaptsToTwoColumnsThreeRows() {
        val portraitViewport = Rect(0, 0, 600, 1024)
        val status = GatewayStatus(
            running = true,
            vehicleId = "car-alpha",
            adapterConnected = true,
            sampledAtElapsedMs = 5_000L,
            liveGauges = LiveGaugeSnapshot(sampledAtElapsedMs = 5_000L)
        )

        renderer.draw(canvas, portraitViewport, dpi = 160, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 5_200L)

        val root = renderer.rootView
        assertNotNull(root)
        assertEquals(600, root?.width)
        assertEquals(1024, root?.height)

        val slot0 = root!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
        val slot1 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot1)
        val slot2 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
        val slot3 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot3)
        val slot4 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot4)
        val slot5 = root.findViewById<TelemetryWidgetView>(R.id.widgetSlot5)

        // Row 1: Speed (slot 0) and RPM (slot 1) side by side
        assertEquals(slot0.top, slot1.top)
        assertTrue(slot0.left < slot1.left)

        // Row 2: Throttle (slot 2) and Engine Load (slot 3) side by side below Row 1
        assertEquals(slot2.top, slot3.top)
        assertTrue(boundsInRoot(root, slot2).top >= boundsInRoot(root, slot0).bottom)
        assertTrue(slot2.left < slot3.left)

        // Row 3: Coolant (slot 4) and Intake Temp (slot 5) side by side below Row 2
        assertEquals(slot4.top, slot5.top)
        assertTrue(boundsInRoot(root, slot4).top >= boundsInRoot(root, slot2).bottom)
        assertTrue(slot4.left < slot5.left)
    }

    @Test
    fun densityChangeTriggersRebuildAndAppliesHostDpi() {
        val viewport = Rect(0, 0, 800, 480)
        val status = GatewayStatus(
            running = true,
            vehicleId = "car-alpha",
            adapterConnected = true,
            sampledAtElapsedMs = 1_000L,
            liveGauges = LiveGaugeSnapshot(sampledAtElapsedMs = 1_000L)
        )

        renderer.draw(canvas, viewport, dpi = 160, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 1_200L)
        val root1 = renderer.rootView
        assertNotNull(root1)
        assertEquals(160, root1?.resources?.displayMetrics?.densityDpi)

        renderer.draw(canvas, viewport, dpi = 320, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 1_300L)
        val root2 = renderer.rootView
        assertNotNull(root2)
        assertNotSame("Changing DPI must rebuild the view hierarchy", root1, root2)
        assertEquals(320, root2?.resources?.displayMetrics?.densityDpi)
    }

    @Test
    fun headerShowsHonestStoppedWaitingConnectedStates() {
        val viewport = Rect(0, 0, 800, 480)

        // 1. Service stopped
        val stoppedStatus = GatewayStatus(running = false, vehicleId = "car-alpha", adapterConnected = false)
        renderer.draw(canvas, viewport, dpi = 160, status = stoppedStatus, activeVehicleId = "car-alpha", nowElapsedMs = 1_000L)
        val tvStatus = renderer.rootView?.findViewById<TextView>(R.id.tvCockpitStatus)
        assertEquals("Stopped", tvStatus?.text.toString())

        // 2. Service running, adapter disconnected -> Waiting
        val disconnectedStatus = GatewayStatus(
            running = true,
            vehicleId = "car-alpha",
            adapterConnected = false,
            sampledAtElapsedMs = 1_000L,
            liveGauges = LiveGaugeSnapshot(sampledAtElapsedMs = 1_000L)
        )
        renderer.draw(canvas, viewport, dpi = 160, status = disconnectedStatus, activeVehicleId = "car-alpha", nowElapsedMs = 1_100L)
        assertEquals("Waiting", tvStatus?.text.toString())

        // 3. Service running, adapter connected, fresh matching vehicle -> Connected
        val connectedStatus = GatewayStatus(
            running = true,
            vehicleId = "car-alpha",
            adapterConnected = true,
            sampledAtElapsedMs = 2_000L,
            liveGauges = LiveGaugeSnapshot(sampledAtElapsedMs = 2_000L)
        )
        renderer.draw(canvas, viewport, dpi = 160, status = connectedStatus, activeVehicleId = "car-alpha", nowElapsedMs = 2_200L)
        assertEquals("Connected", tvStatus?.text.toString())

        // 4. Stale snapshot (> 5000ms old) -> Waiting
        renderer.draw(canvas, viewport, dpi = 160, status = connectedStatus, activeVehicleId = "car-alpha", nowElapsedMs = 8_000L)
        assertEquals("Waiting", tvStatus?.text.toString())

        // 5. Cross-vehicle snapshot -> Waiting
        renderer.draw(canvas, viewport, dpi = 160, status = connectedStatus, activeVehicleId = "car-beta", nowElapsedMs = 2_200L)
        assertEquals("Waiting", tvStatus?.text.toString())
    }

    @Test
    fun engineGaugesFilledOnlyWithFreshRunningMatchingVehicleData() {
        val viewport = Rect(0, 0, 800, 480)
        val snapshot = LiveGaugeSnapshot(
            speedKmh = 65f,
            speedSource = "OBD",
            obdSpeedKmh = 65f, obdSpeedAtElapsedMs = 5_000L,
            rpm = 2200,
            throttlePos = 25,
            engineLoad = 40,
            coolantTemp = 88,
            intakeAirTemp = 28,
            sampledAtElapsedMs = 5_000L
        )
        val status = GatewayStatus(
            running = true,
            vehicleId = "car-alpha",
            adapterConnected = true,
            sampledAtElapsedMs = 5_000L,
            liveGauges = snapshot
        )

        // Fresh running matching-vehicle sample
        renderer.draw(canvas, viewport, dpi = 160, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 5_500L)

        val slot0 = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
        val slot1 = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot1)
        val slot2 = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
        val slot3 = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot3)
        val slot4 = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot4)
        val slot5 = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot5)

        assertTrue("Speed gauge must be available", slot0.isMetricAvailable)
        assertTrue("RPM gauge must be available", slot1.isMetricAvailable)
        assertTrue("Throttle gauge must be available", slot2.isMetricAvailable)
        assertTrue("Engine load gauge must be available", slot3.isMetricAvailable)
        assertTrue("Coolant gauge must be available", slot4.isMetricAvailable)
        assertTrue("Intake temp gauge must be available", slot5.isMetricAvailable)

        // Stale sample (> 5000ms old) sets gauges unavailable
        renderer.draw(canvas, viewport, dpi = 160, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 11_000L)
        assertFalse("Speed gauge must be unavailable when stale", slot0.isMetricAvailable)
        assertFalse("RPM gauge must be unavailable when stale", slot1.isMetricAvailable)
        assertFalse("Throttle gauge must be unavailable when stale", slot2.isMetricAvailable)

        // Cross-vehicle data sets gauges unavailable
        renderer.draw(canvas, viewport, dpi = 160, status = status, activeVehicleId = "car-beta", nowElapsedMs = 5_500L)
        val newRoot = renderer.rootView!!
        val slot0Beta = newRoot.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
        assertFalse("Gauges must not fill for cross-vehicle data", slot0Beta.isMetricAvailable)

        // Stopped service sets gauges unavailable
        val stoppedStatus = status.copy(running = false)
        renderer.draw(canvas, viewport, dpi = 160, status = stoppedStatus, activeVehicleId = "car-alpha", nowElapsedMs = 5_500L)
        val slot0Stopped = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
        assertFalse("Gauges must not fill when service is stopped", slot0Stopped.isMetricAvailable)
    }

    @Test
    fun speedComparisonUsesIndependentTimestampsAndNeverSelfComparesGpsFallback() {
        val viewport = Rect(0, 0, 800, 480)

        // 1. Fresh independent OBD & GPS timestamps
        val snapshotBoth = LiveGaugeSnapshot(
            speedKmh = 80f,
            speedSource = "OBD",
            sampledAtElapsedMs = 10_000L,
            obdSpeedKmh = 80f,
            obdSpeedAtElapsedMs = 9_950L,
            gpsSpeedKmh = 78f,
            gpsSpeedAtElapsedMs = 9_900L
        )
        val statusBoth = GatewayStatus(
            running = true,
            vehicleId = "car-alpha",
            adapterConnected = true,
            sampledAtElapsedMs = 10_000L,
            liveGauges = snapshotBoth
        )

        renderer.draw(canvas, viewport, dpi = 160, status = statusBoth, activeVehicleId = "car-alpha", nowElapsedMs = 10_100L)
        val slot0 = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot0)
        val compRow = slot0.findViewById<TextView>(R.id.speedComparisonRow)
        assertEquals("GPS 78.0 km/h · OBD−GPS +2.0 km/h", compRow.text.toString())
        assertEquals("OBD SPEED", slot0.findViewById<CircularGaugeView>(R.id.dialGaugeView).title)

        // 2. High timestamp skew between OBD and GPS (> 1500ms): difference suppressed
        val snapshotSkewed = LiveGaugeSnapshot(
            speedKmh = 80f,
            speedSource = "OBD",
            sampledAtElapsedMs = 10_000L,
            obdSpeedKmh = 80f,
            obdSpeedAtElapsedMs = 9_950L,
            gpsSpeedKmh = 78f,
            gpsSpeedAtElapsedMs = 7_500L
        )
        val statusSkewed = statusBoth.copy(liveGauges = snapshotSkewed)
        renderer.draw(canvas, viewport, dpi = 160, status = statusSkewed, activeVehicleId = "car-alpha", nowElapsedMs = 10_100L)
        assertEquals("GPS 78.0 km/h · OBD−GPS — km/h", compRow.text.toString())

        // 3. GPS fallback only: never compare GPS against itself
        val snapshotGpsOnly = LiveGaugeSnapshot(
            speedKmh = 75f,
            speedSource = "GPS",
            sampledAtElapsedMs = 10_000L,
            obdSpeedKmh = null,
            obdSpeedAtElapsedMs = null,
            gpsSpeedKmh = 75f,
            gpsSpeedAtElapsedMs = 9_900L
        )
        val statusGpsOnly = statusBoth.copy(liveGauges = snapshotGpsOnly)
        renderer.draw(canvas, viewport, dpi = 160, status = statusGpsOnly, activeVehicleId = "car-alpha", nowElapsedMs = 10_100L)
        assertEquals("GPS 75.0 km/h · OBD−GPS — km/h", compRow.text.toString())
        assertEquals("GPS SPEED", slot0.findViewById<CircularGaugeView>(R.id.dialGaugeView).title)
    }

    @Test
    fun tripFuelRetainedAsPausedThroughShortGapsAndExpiresAfterFiveMinutes() {
        val viewport = Rect(0, 0, 800, 480)
        val snapshot = LiveGaugeSnapshot(
            speedKmh = 60f,
            throttlePos = 20,
            sampledAtElapsedMs = 10_000L,
            tripEconomyKmL = 18.2,
            tripCoverageRatio = 0.85,
            tripSampledAtElapsedMs = 10_000L
        )
        val status = GatewayStatus(
            running = true,
            vehicleId = "car-alpha",
            adapterConnected = true,
            sampledAtElapsedMs = 10_000L,
            liveGauges = snapshot
        )

        // 1. Live connected reading
        renderer.draw(canvas, viewport, dpi = 160, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 10_500L)
        val slot2 = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
        val readout = slot2.findViewById<TextView>(R.id.tvThrottleTripFuel)
        val quality = slot2.findViewById<TextView>(R.id.tvTripFuelQuality)

        assertEquals("18.2", readout.text.toString())
        assertEquals("Est. · 85% sampled", quality.text.toString())

        // 2. Short stopped gap: reading retained as Paused
        val stoppedStatus = status.copy(running = false, liveGauges = null)
        renderer.draw(canvas, viewport, dpi = 160, status = stoppedStatus, activeVehicleId = "car-alpha", nowElapsedMs = 20_000L)
        assertEquals("18.2", readout.text.toString())
        assertTrue("Quality must start with Paused during stopped gap", quality.text.toString().startsWith("Paused"))

        // 3. Short disconnected gap: reading retained as Paused
        val disconnectedStatus = status.copy(running = true, adapterConnected = false, liveGauges = null)
        renderer.draw(canvas, viewport, dpi = 160, status = disconnectedStatus, activeVehicleId = "car-alpha", nowElapsedMs = 40_000L)
        assertEquals("18.2", readout.text.toString())
        assertTrue("Quality must start with Paused during disconnected gap", quality.text.toString().startsWith("Paused"))

        // 4. Expiry after 5 minutes (> 300,000ms): reading cleared to "—"
        val expiredElapsed = 10_000L + TripFuelAccumulator.TRIP_GAP_MS + 1000L
        renderer.draw(canvas, viewport, dpi = 160, status = stoppedStatus, activeVehicleId = "car-alpha", nowElapsedMs = expiredElapsed)
        assertEquals("—", readout.text.toString())

        // 5. Switching vehicle clears retained trip reading immediately
        renderer.draw(canvas, viewport, dpi = 160, status = status, activeVehicleId = "car-alpha", nowElapsedMs = 10_500L)
        assertEquals("18.2", renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot2).findViewById<TextView>(R.id.tvThrottleTripFuel).text.toString())

        renderer.draw(canvas, viewport, dpi = 160, status = status, activeVehicleId = "car-beta", nowElapsedMs = 10_600L)
        assertEquals("—", renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot2).findViewById<TextView>(R.id.tvThrottleTripFuel).text.toString())

        // 6. Protection against NaN and Infinity
        val nanSnapshot = LiveGaugeSnapshot(
            speedKmh = 60f,
            sampledAtElapsedMs = 50_000L,
            tripEconomyKmL = Double.NaN,
            tripCoverageRatio = 0.9,
            tripSampledAtElapsedMs = 50_000L
        )
        val nanStatus = status.copy(liveGauges = nanSnapshot, sampledAtElapsedMs = 50_000L)
        renderer.draw(canvas, viewport, dpi = 160, status = nanStatus, activeVehicleId = "car-alpha", nowElapsedMs = 50_200L)
        val nanReadout = renderer.rootView!!.findViewById<TelemetryWidgetView>(R.id.widgetSlot2).findViewById<TextView>(R.id.tvThrottleTripFuel).text.toString()
        assertFalse("Must never display NaN", nanReadout.contains("NaN", ignoreCase = true))
        assertEquals("—", nanReadout)
    }

    private fun boundsInRoot(root: View, child: View): Rect {
        val bounds = Rect()
        child.getDrawingRect(bounds)
        (root as ViewGroup).offsetDescendantRectToMyCoords(child, bounds)
        return bounds
    }

    private fun assertNoControls(view: View) {
        assertFalse("View must not be a Button: ${view.javaClass.simpleName}", view is Button)
        assertFalse("View must not be an ImageButton: ${view.javaClass.simpleName}", view is ImageButton)

        if (view is TelemetryWidgetView) {
            assertFalse("Telemetry slot must not be clickable", view.isClickable)
            assertFalse("Telemetry slot must not be focusable", view.isFocusable)
            assertFalse("Telemetry slot cannot mutate cockpit", view.canMutateCockpit?.invoke() ?: true)
        }

        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                assertNoControls(view.getChildAt(i))
            }
        }
    }
}
