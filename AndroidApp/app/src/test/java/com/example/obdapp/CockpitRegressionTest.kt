package com.example.obdapp

import android.content.Context
import android.content.Intent
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.widget.PopupMenu
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class CockpitRegressionTest {

    private lateinit var context: Context

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        MainActivity.resetVehicleMotionSessionForTesting()
    }

    @After
    fun tearDown() {
        MainActivity.resetVehicleMotionSessionForTesting()
    }

    // --- Finding 1 Regressions: Touch Stream Ownership & Accessibility ---

    @Test
    fun testInnerFrameLayoutDoesNotConsumeGestures() {
        val widget = TelemetryWidgetView(context)
        widget.measure(
            View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY)
        )
        widget.layout(0, 0, 300, 300)

        val innerRoot = widget.findViewById<FrameLayout>(R.id.telemetryWidgetRoot)
        assertNotNull(innerRoot)
        assertFalse("Inner card FrameLayout must not be clickable", innerRoot.isClickable)
        assertFalse("Inner card FrameLayout must not be focusable", innerRoot.isFocusable)
        assertTrue("Outer TelemetryWidgetView must be clickable", widget.isClickable)
    }

    @Test
    fun testTapGestureCyclesStyleWhenStationary() {
        val widget = TelemetryWidgetView(context)
        widget.measure(
            View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY)
        )
        widget.layout(0, 0, 300, 300)
        widget.canMutateCockpit = { true }
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.DIAL)

        assertEquals(DisplayStyle.DIAL, widget.currentStyle)

        // Dispatch tap event sequence
        val downTime = SystemClock.uptimeMillis()
        val downEvent = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, 150f, 150f, 0)
        val upEvent = MotionEvent.obtain(downTime, downTime + 50, MotionEvent.ACTION_UP, 150f, 150f, 0)

        val downHandled = widget.dispatchTouchEvent(downEvent)
        val upHandled = widget.dispatchTouchEvent(upEvent)

        assertTrue("TelemetryWidgetView should consume touch stream", downHandled)
        assertTrue("TelemetryWidgetView should consume touch stream", upHandled)

        // Advance main looper so onSingleTapConfirmed fires after double-tap timeout
        shadowOf(Looper.getMainLooper()).idleFor(500, TimeUnit.MILLISECONDS)

        // Single tap confirmed cycles DIAL -> BAR
        assertEquals(DisplayStyle.BAR, widget.currentStyle)

        downEvent.recycle()
        upEvent.recycle()
    }

    @Test
    fun testPerformClickCyclesStyleExactlyOnceAndRespectsPermission() {
        val widget = TelemetryWidgetView(context)
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.DIAL)
        widget.canMutateCockpit = { true }

        var listenerFiredCount = 0
        widget.onStyleChangedListener = { listenerFiredCount++ }

        val handled1 = widget.performClick()
        assertTrue(handled1)
        assertEquals(DisplayStyle.BAR, widget.currentStyle)
        assertEquals(1, listenerFiredCount)

        val handled2 = widget.performClick()
        assertTrue(handled2)
        assertEquals(DisplayStyle.DIGITAL, widget.currentStyle)
        assertEquals(2, listenerFiredCount)

        // When locked (canMutateCockpit returns false)
        widget.canMutateCockpit = { false }
        val handled3 = widget.performClick()
        assertFalse(handled3)
        assertEquals(DisplayStyle.DIGITAL, widget.currentStyle)
        assertEquals(2, listenerFiredCount) // Must not advance
    }

    @Test
    fun testDoubleTapDoesNotCycleStyles() {
        val widget = TelemetryWidgetView(context)
        widget.measure(
            View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY)
        )
        widget.layout(0, 0, 300, 300)
        widget.canMutateCockpit = { true }
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.DIAL)

        var doubleTapFired = false
        widget.onDoubleTapListener = { doubleTapFired = true }

        val t1 = SystemClock.uptimeMillis()
        // First tap
        val down1 = MotionEvent.obtain(t1, t1, MotionEvent.ACTION_DOWN, 150f, 150f, 0)
        val up1 = MotionEvent.obtain(t1, t1 + 20, MotionEvent.ACTION_UP, 150f, 150f, 0)
        widget.dispatchTouchEvent(down1)
        widget.dispatchTouchEvent(up1)

        val t2 = t1 + 60
        // Second tap
        val down2 = MotionEvent.obtain(t2, t2, MotionEvent.ACTION_DOWN, 150f, 150f, 0)
        val up2 = MotionEvent.obtain(t2, t2 + 20, MotionEvent.ACTION_UP, 150f, 150f, 0)
        widget.dispatchTouchEvent(down2)
        widget.dispatchTouchEvent(up2)

        ShadowLooper.idleMainLooper()

        assertTrue("Double tap listener should be triggered", doubleTapFired)
        // Style must NOT cycle on double-tap
        assertEquals("Double tap must not cycle styles", DisplayStyle.DIAL, widget.currentStyle)

        down1.recycle()
        up1.recycle()
        down2.recycle()
        up2.recycle()
    }

    // --- Finding 2 Regressions: Dial Geometry & Consistent Labels ---

    @Test
    fun testSmallRpmDialLabelsAndTicksMatchWithoutTruncation() {
        val gauge = CircularGaugeView(context)
        gauge.minValue = 0f
        gauge.maxValue = 8000f
        gauge.majorTickInterval = 1000f

        // Small 200px diameter dial
        gauge.measure(
            View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY)
        )
        gauge.layout(0, 0, 200, 200)

        // Read cached labels via reflection
        val fieldLabels = CircularGaugeView::class.java.getDeclaredField("cachedTickLabels")
        fieldLabels.isAccessible = true
        val labels = fieldLabels.get(gauge) as Array<String>

        val fieldValues = CircularGaugeView::class.java.getDeclaredField("cachedTickValues")
        fieldValues.isAccessible = true
        val values = fieldValues.get(gauge) as FloatArray

        assertEquals(labels.size, values.size)
        // With adaptive declutter at diameter < 220, step multiplier is 2 (step 2000)
        // Ticks should be: 0, 2000, 4000, 6000, 8000
        assertEquals(5, values.size)
        assertEquals(0f, values[0], 0.01f)
        assertEquals(2000f, values[1], 0.01f)
        assertEquals(4000f, values[2], 0.01f)
        assertEquals(6000f, values[3], 0.01f)
        assertEquals(8000f, values[4], 0.01f)

        // In thousands: 0, 2, 4, 6, 8 (NEVER 0, 1, 3, 4, 6, 8)
        assertEquals("0", labels[0])
        assertEquals("2", labels[1])
        assertEquals("4", labels[2])
        assertEquals("6", labels[3])
        assertEquals("8", labels[4])
    }

    @Test
    fun testNonZeroMinimaAndNonDivisibleRangesIncludeEndpoints() {
        val gauge = CircularGaugeView(context)
        // 1. Battery range 9V to 16V with step 1V
        gauge.minValue = 9f
        gauge.maxValue = 16f
        gauge.majorTickInterval = 1f
        gauge.measure(
            View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY)
        )
        gauge.layout(0, 0, 300, 300)

        val fieldValues = CircularGaugeView::class.java.getDeclaredField("cachedTickValues")
        fieldValues.isAccessible = true
        val values = fieldValues.get(gauge) as FloatArray

        assertEquals(9f, values.first(), 0.01f)
        assertEquals(16f, values.last(), 0.01f)

        // 2. Genuinely non-divisible range: 0 to 225 with interval 20 (225 % 20 != 0)
        gauge.minValue = 0f
        gauge.maxValue = 225f
        gauge.majorTickInterval = 20f
        gauge.layout(0, 0, 300, 300)
        val nonDivValues = fieldValues.get(gauge) as FloatArray
        assertEquals(0f, nonDivValues.first(), 0.01f)
        assertEquals(225f, nonDivValues.last(), 0.01f)
        assertEquals(220f, nonDivValues[nonDivValues.size - 2], 0.01f)

        // 3. Large span with > 50 raw ticks: GPS Altitude -50 to 3000 with interval 20
        // (Span = 3050, 152.5 raw intervals)
        gauge.minValue = -50f
        gauge.maxValue = 3000f
        gauge.majorTickInterval = 20f
        gauge.layout(0, 0, 300, 300)
        val altValues = fieldValues.get(gauge) as FloatArray
        val fieldLabels = CircularGaugeView::class.java.getDeclaredField("cachedTickLabels")
        fieldLabels.isAccessible = true
        val altLabels = fieldLabels.get(gauge) as Array<String>

        // Crucial bug fix assertion: Must include -50 and 3000 (NEVER truncate at 930!)
        assertEquals(-50f, altValues.first(), 0.01f)
        assertEquals(3000f, altValues.last(), 0.01f)
        assertEquals("-50", altLabels.first())
        assertEquals("3", altLabels.last())
        assertTrue("Tick budget must be bounded (<= 40 ticks)", altValues.size <= 40)

        // 4. Same large span on small dial (200px diameter): Must end at 3000 (NEVER truncate at 1910!)
        gauge.measure(
            View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY)
        )
        gauge.layout(0, 0, 200, 200)
        val smallAltValues = fieldValues.get(gauge) as FloatArray
        assertEquals(-50f, smallAltValues.first(), 0.01f)
        assertEquals(3000f, smallAltValues.last(), 0.01f)
        assertTrue("Small dial tick budget must be bounded (<= 20 ticks)", smallAltValues.size <= 20)

        // 5. Invalid interval <= 0 falls back cleanly without crash
        gauge.majorTickInterval = 0f
        val fallbackValues = fieldValues.get(gauge) as FloatArray
        assertTrue(fallbackValues.size >= 2)
    }

    @Test
    fun testGaugeUnavailableStateDisplaysNA() {
        val gauge = CircularGaugeView(context)
        gauge.minValue = 0f
        gauge.maxValue = 100f
        gauge.isAvailable = false

        val fieldFormatted = CircularGaugeView::class.java.getDeclaredField("cachedFormattedValue")
        fieldFormatted.isAccessible = true
        assertEquals("N/A", fieldFormatted.get(gauge))

        gauge.currentValue = 42f
        assertEquals("42", fieldFormatted.get(gauge))
        assertTrue(gauge.isAvailable)
    }

    // --- Finding 3 Regressions: Telemetry State Preservation ---

    @Test
    fun testSameMetricRebindPreservesReadingsAndHistorySilently() {
        val widget = TelemetryWidgetView(context)
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.DIGITAL)

        // Initially unavailable
        assertFalse(widget.isMetricAvailable)

        // Deliver multiple samples to establish readings, session extrema, and sparkline history
        widget.updateValue(50.0)
        widget.updateValue(75.0)
        widget.updateValue(60.0)
        assertTrue(widget.isMetricAvailable)

        val tvVal = widget.findViewById<TextView>(R.id.tvDigitalValue)
        val tvMinMax = widget.findViewById<TextView>(R.id.tvDigitalMinMax)
        assertEquals("60", tvVal.text.toString())
        assertTrue(tvMinMax.text.toString().contains("Min: 50.0"))
        assertTrue(tvMinMax.text.toString().contains("Max: 75.0"))

        val fieldCurrentVal = TelemetryWidgetView::class.java.getDeclaredField("currentValue").apply { isAccessible = true }
        val fieldSessionMin = TelemetryWidgetView::class.java.getDeclaredField("sessionMin").apply { isAccessible = true }
        val fieldSessionMax = TelemetryWidgetView::class.java.getDeclaredField("sessionMax").apply { isAccessible = true }
        val fieldDigitalSpark = TelemetryWidgetView::class.java.getDeclaredField("digitalSparkline").apply { isAccessible = true }
        val sparkline = fieldDigitalSpark.get(widget) as SparklineView
        val fieldSpeedHist = SparklineView::class.java.getDeclaredField("speedHistory").apply { isAccessible = true }
        val speedHist = fieldSpeedHist.get(sparkline) as List<*>

        assertEquals(60.0, fieldCurrentVal.get(widget) as Double, 0.01)
        assertEquals(50.0, fieldSessionMin.get(widget) as Double, 0.01)
        assertEquals(75.0, fieldSessionMax.get(widget) as Double, 0.01)
        assertEquals(3, speedHist.size)
        assertEquals(50f, speedHist[0] as Float, 0.01f)
        assertEquals(75f, speedHist[1] as Float, 0.01f)
        assertEquals(60f, speedHist[2] as Float, 0.01f)

        var listenerFired = false
        widget.onStyleChangedListener = { listenerFired = true }

        // Rebind same metric to BAR
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.BAR)

        // Readings, session extrema, availability, and sparkline history preserved while on BAR!
        assertTrue(widget.isMetricAvailable)
        assertEquals(DisplayStyle.BAR, widget.currentStyle)
        val bar = widget.findViewById<LinearBarGaugeView>(R.id.barGaugeView)
        assertEquals(60f, bar.currentValue, 0.01f)
        assertTrue(bar.isAvailable)
        assertEquals(60.0, fieldCurrentVal.get(widget) as Double, 0.01)
        assertEquals(50.0, fieldSessionMin.get(widget) as Double, 0.01)
        assertEquals(75.0, fieldSessionMax.get(widget) as Double, 0.01)
        assertEquals(3, speedHist.size)
        assertEquals(50f, speedHist[0] as Float, 0.01f)
        assertEquals(75f, speedHist[1] as Float, 0.01f)
        assertEquals(60f, speedHist[2] as Float, 0.01f)
        assertFalse("Same-metric rebind must update style silently without triggering onStyleChangedListener", listenerFired)

        // Rebind same metric to GRAPH
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.GRAPH)
        assertEquals(DisplayStyle.GRAPH, widget.currentStyle)
        val tvGraphVal = widget.findViewById<TextView>(R.id.tvGraphValue)
        assertEquals("60 km/h", tvGraphVal.text.toString())
        assertEquals(3, speedHist.size)
        assertEquals(50f, speedHist[0] as Float, 0.01f)
        assertEquals(75f, speedHist[1] as Float, 0.01f)
        assertEquals(60f, speedHist[2] as Float, 0.01f)

        // Return back to DIGITAL: verify retained samples and count are intact
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.DIGITAL)
        assertEquals(DisplayStyle.DIGITAL, widget.currentStyle)
        assertEquals("60", tvVal.text.toString())
        assertTrue(tvMinMax.text.toString().contains("Min: 50.0"))
        assertTrue(tvMinMax.text.toString().contains("Max: 75.0"))
        assertEquals(3, speedHist.size)
        assertEquals(50f, speedHist[0] as Float, 0.01f)
        assertEquals(75f, speedHist[1] as Float, 0.01f)
        assertEquals(60f, speedHist[2] as Float, 0.01f)
    }

    @Test
    fun testNegativeReadingsComputeExtremaCorrectly() {
        val widget = TelemetryWidgetView(context)
        widget.bindMetric(TelemetryMetric.COOLANT, DisplayStyle.DIGITAL)

        // Deliver negative samples (e.g. cold ambient / intake temp -15 and -10)
        widget.updateValue(-15.0)
        widget.updateValue(-10.0)

        val fieldSessionMin = TelemetryWidgetView::class.java.getDeclaredField("sessionMin").apply { isAccessible = true }
        val fieldSessionMax = TelemetryWidgetView::class.java.getDeclaredField("sessionMax").apply { isAccessible = true }

        assertEquals(-15.0, fieldSessionMin.get(widget) as Double, 0.01)
        assertEquals(-10.0, fieldSessionMax.get(widget) as Double, 0.01)

        val tvMinMax = widget.findViewById<TextView>(R.id.tvDigitalMinMax)
        assertTrue("Min must be -15.0", tvMinMax.text.toString().contains("Min: -15.0"))
        assertTrue("Max must be -10.0 (NEVER 0.0)", tvMinMax.text.toString().contains("Max: -10.0"))
    }

    @Test
    fun testMetricChangeResetsStateToUnavailable() {
        val widget = TelemetryWidgetView(context)
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.DIGITAL)
        widget.updateValue(80.0)
        assertTrue(widget.isMetricAvailable)

        val fieldSessionMin = TelemetryWidgetView::class.java.getDeclaredField("sessionMin").apply { isAccessible = true }
        val fieldSessionMax = TelemetryWidgetView::class.java.getDeclaredField("sessionMax").apply { isAccessible = true }
        val fieldDigitalSpark = TelemetryWidgetView::class.java.getDeclaredField("digitalSparkline").apply { isAccessible = true }
        val sparkline = fieldDigitalSpark.get(widget) as SparklineView
        val fieldSpeedHist = SparklineView::class.java.getDeclaredField("speedHistory").apply { isAccessible = true }

        // Switch to COOLANT
        widget.bindMetric(TelemetryMetric.COOLANT, DisplayStyle.BAR)

        // Must reset to unavailable until new sample arrives
        assertFalse("New metric must be marked unavailable until first sample arrives", widget.isMetricAvailable)
        val bar = widget.findViewById<LinearBarGaugeView>(R.id.barGaugeView)
        assertFalse("Bar view must be marked unavailable", bar.isAvailable)

        // Extrema and sparkline history must be reset
        assertEquals(Double.MAX_VALUE, fieldSessionMin.get(widget) as Double, 0.01)
        assertEquals(-Double.MAX_VALUE, fieldSessionMax.get(widget) as Double, 0.01)
        val speedHistAfter = fieldSpeedHist.get(sparkline) as List<*>
        assertEquals(0, speedHistAfter.size)
    }

    // --- Findings 4, 5, 6 Regressions: Motion State Machine & Demo Isolation ---

    @Test
    fun testMotionStateTransitionsAndFreshnessExpiry() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()

        // 1. Initial state: speed is unknown -> mutation blocked
        activity.evaluateMotionState()
        assertFalse("Cockpit mutation must be blocked when speed is unknown", activity.isCockpitMutationPermitted())

        // 2. Fresh stationary telemetry (0 km/h) -> mutation permitted
        val intentStationary = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 0.0f)
            putExtra("timestamp", System.currentTimeMillis())
        }
        val method = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
        method.invoke(activity, intentStationary, true)

        activity.evaluateMotionState()
        assertTrue("Cockpit mutation must be permitted when vehicle is confirmed stationary", activity.isCockpitMutationPermitted())

        // 3. Vehicle moves (45 km/h) -> mutation locked
        val intentMoving = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 45.0f)
            putExtra("timestamp", System.currentTimeMillis())
        }
        method.invoke(activity, intentMoving, true)
        activity.evaluateMotionState()
        assertFalse("Cockpit mutation must be locked when vehicle is in motion", activity.isCockpitMutationPermitted())

        // 4. Stale speed expiry without broadcast (>6000ms):
        // Previously moving lock MUST NOT be cleared by stale telemetry!
        ShadowSystemClock.advanceBy(10, TimeUnit.SECONDS)
        activity.evaluateMotionState()
        assertFalse("Stale telemetry must NEVER clear a previously moving lock", activity.isCockpitMutationPermitted())

        // 5. Fresh 0 km/h reading returns to STATIONARY
        method.invoke(activity, intentStationary, true)
        activity.evaluateMotionState()
        assertTrue("Fresh stationary reading clears moving lock", activity.isCockpitMutationPermitted())
    }

    @Test
    fun testTimerDrivenExpiryAndDismissalWithoutBroadcast() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val method = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }

        // Stationary
        val intentStationary = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 0.0f)
        }
        method.invoke(activity, intentStationary, true)
        assertTrue(activity.isCockpitMutationPermitted())

        // Open slot customizer dialog
        val showDialog = MainActivity::class.java.getDeclaredMethod("showSlotCustomizerDialog", Int::class.javaPrimitiveType).apply { isAccessible = true }
        showDialog.invoke(activity, 0)

        val dialogField = MainActivity::class.java.getDeclaredField("activeCustomizerDialog").apply { isAccessible = true }
        val dialog = dialogField.get(activity) as? android.app.Dialog
        assertNotNull("Dialog must be active", dialog)
        assertTrue("Dialog must be showing", dialog!!.isShowing)

        // Open preset popup
        val btnPreset = activity.findViewById<TextView>(R.id.btnPresetSelector)
        btnPreset?.performClick()
        val popupField = MainActivity::class.java.getDeclaredField("activePresetPopup").apply { isAccessible = true }
        val popup = popupField.get(activity) as? PopupMenu
        assertNotNull("Popup must be active", popup)

        // Advance clock by 7s and idle main looper to trigger ageTicker coroutine without any broadcast
        ShadowSystemClock.advanceBy(7, TimeUnit.SECONDS)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(7))

        // Check window dismissal first, without calling evaluateMotionState() or isCockpitMutationPermitted()
        assertNull("Active customizer dialog must be dismissed and cleared by timer alone", dialogField.get(activity))
        assertFalse("Dialog must not be showing", dialog.isShowing)
        assertNull("Active preset popup must be dismissed and cleared by timer alone", popupField.get(activity))

        // Verify motion state transitioned to UNKNOWN without manual invocation
        val motionStateField = MainActivity::class.java.getDeclaredField("currentMotionState").apply { isAccessible = true }
        assertEquals(MainActivity.VehicleMotionState.UNKNOWN, motionStateField.get(activity))
        assertFalse("Cockpit mutation must be locked after timer expiry", activity.isCockpitMutationPermitted())
    }

    @Test
    fun testLiveMovementOverridesDemoModeAndStopDemoResetsSpeed() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val method = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
        val demoField = MainActivity::class.java.getDeclaredField("demoSpeedKmh").apply { isAccessible = true }

        // Live speed reports 60 km/h
        val intentMoving = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 60.0f)
        }
        method.invoke(activity, intentMoving, true)
        activity.evaluateMotionState()
        assertFalse(activity.isCockpitMutationPermitted())
        assertEquals(60f, activity.currentVehicleSpeedKmh, 0.01f)

        // Start demo mode and deliver simulated demo speed of 25 km/h
        activity.startDemoMode()
        val intentDemo = Intent("com.example.obdapp.MOCK_TELEMETRY").apply {
            putExtra("speed", 25.0f)
        }
        method.invoke(activity, intentDemo, false)
        activity.evaluateMotionState()

        // In demo mode, currentVehicleSpeedKmh reflects demo speed (25 km/h)
        assertEquals(25f, activity.currentVehicleSpeedKmh, 0.01f)
        // But live movement still overrides demo mode for mutation permission!
        assertFalse("Live movement must override demo mode", activity.isCockpitMutationPermitted())

        // Stop demo mode
        activity.stopDemoMode()

        // demoSpeedKmh must be reset to 0f
        assertEquals(0f, demoField.get(activity) as Float, 0.01f)
        // Live speed of 60 km/h must be preserved in currentVehicleSpeedKmh!
        assertEquals(60f, activity.currentVehicleSpeedKmh, 0.01f)
        assertFalse("Mutation remains locked after stopping demo while vehicle was moving", activity.isCockpitMutationPermitted())
    }

    @Test
    fun testEscapingFocusWhileLockedAndAutoRestoreOnMotion() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val method = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
        val toggleFocus = MainActivity::class.java.getDeclaredMethod("toggleSlotFocus", Int::class.javaPrimitiveType).apply { isAccessible = true }
        val fieldFocused = MainActivity::class.java.getDeclaredField("focusedSlotIndex").apply { isAccessible = true }

        // 1. Vehicle is stationary -> allow entering focus
        val intentStationary = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 0.0f)
        }
        method.invoke(activity, intentStationary, true)
        activity.evaluateMotionState()
        assertTrue(activity.isCockpitMutationPermitted())

        // Focus slot 0
        toggleFocus.invoke(activity, 0)
        assertEquals(0, fieldFocused.get(activity))

        // 2. Put vehicle in motion (60 km/h) -> grid is automatically restored for driving safety
        val intentMoving = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 60.0f)
        }
        method.invoke(activity, intentMoving, true)
        activity.evaluateMotionState()
        assertFalse(activity.isCockpitMutationPermitted())
        // Auto-restored to null by motion!
        assertEquals("Motion must auto-restore cockpit grid", null, fieldFocused.get(activity))

        // 3. Reset vehicle to stationary, re-enter focus on slot 0
        method.invoke(activity, intentStationary, true)
        activity.evaluateMotionState()
        toggleFocus.invoke(activity, 0)
        assertEquals(0, fieldFocused.get(activity))

        // 4. Stale telemetry (>6s elapsed) transitions state to UNKNOWN, locking mutations
        ShadowSystemClock.advanceBy(10, TimeUnit.SECONDS)
        activity.evaluateMotionState()
        assertFalse("Stale telemetry locks cockpit mutation", activity.isCockpitMutationPermitted())
        // Focus is still on slot 0
        assertEquals(0, fieldFocused.get(activity))

        // 5. Attempting to enter focus on slot 1 while locked is blocked
        toggleFocus.invoke(activity, 1)
        assertEquals("Entering focus on another slot while locked must be blocked", 0, fieldFocused.get(activity))

        // 6. Double-tapping the currently focused slot 0 to EXIT focus must be permitted while locked
        toggleFocus.invoke(activity, 0)
        assertEquals("Exiting focus while locked must be permitted", null, fieldFocused.get(activity))

        // 7. Attempting to re-enter focus while still locked is blocked
        toggleFocus.invoke(activity, 0)
        assertEquals("Re-entering focus while locked must be blocked", null, fieldFocused.get(activity))
    }

    @Test
    fun testPresetPopupBypassesMotionRecheckDefense() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val method = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
        val configManager = DashboardConfigManager(activity)
        assertEquals(DashboardPreset.SPORT, configManager.getActivePreset())

        // 1. Stationary 0 km/h
        val intentStationary = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 0.0f)
        }
        method.invoke(activity, intentStationary, true)
        assertTrue(activity.isCockpitMutationPermitted())

        // 2. Open preset selector popup
        val btnPreset = activity.findViewById<TextView>(R.id.btnPresetSelector)
        btnPreset?.performClick()

        val popupField = MainActivity::class.java.getDeclaredField("activePresetPopup").apply { isAccessible = true }
        val popup = popupField.get(activity) as? PopupMenu
        assertNotNull(popup)

        // 3. Deliver trusted 60 km/h sample -> vehicle in motion!
        val intentMoving = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 60.0f)
        }
        method.invoke(activity, intentMoving, true)
        assertFalse(activity.isCockpitMutationPermitted())
        assertNull("Motion must auto-dismiss active preset popup", popupField.get(activity))

        // 4. Simulate a raced menu item click callback on the popup for CRUISER
        val cruiserItem = popup!!.menu.getItem(DashboardPreset.CRUISER.ordinal)
        val listenerField = PopupMenu::class.java.getDeclaredField("mMenuItemClickListener").apply { isAccessible = true }
        val listener = listenerField.get(popup) as PopupMenu.OnMenuItemClickListener
        listener.onMenuItemClick(cruiserItem)

        // Preset must NOT have changed because mutation is locked
        assertEquals("Preset must remain SPORT when vehicle is in motion", DashboardPreset.SPORT, configManager.getActivePreset())
    }

    @Test
    fun testSaveAfterLockingBlocked() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val method = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
        val configManager = DashboardConfigManager(activity)
        val initialSlot0 = configManager.getMasterSlots(configManager.getActivePreset())[0]

        // 1. Stationary
        val intentStationary = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 0.0f)
        }
        method.invoke(activity, intentStationary, true)
        assertTrue(activity.isCockpitMutationPermitted())

        // 2. Open customizer dialog for slot 0
        val showDialog = MainActivity::class.java.getDeclaredMethod("showSlotCustomizerDialog", Int::class.javaPrimitiveType).apply { isAccessible = true }
        showDialog.invoke(activity, 0)

        val dialogField = MainActivity::class.java.getDeclaredField("activeCustomizerDialog").apply { isAccessible = true }
        val dialog = dialogField.get(activity) as? AlertDialog
        assertNotNull(dialog)

        // Select different metric (COOLANT) and style (BAR) while stationary
        val spinnerMetric = dialog!!.findViewById<Spinner>(R.id.spinnerMetric)
        val spinnerStyle = dialog.findViewById<Spinner>(R.id.spinnerStyle)
        assertNotNull(spinnerMetric)
        assertNotNull(spinnerStyle)

        val coolantIndex = TelemetryMetric.values().indexOf(TelemetryMetric.COOLANT)
        val barIndex = DisplayStyle.values().indexOf(DisplayStyle.BAR)
        spinnerMetric!!.setSelection(coolantIndex)
        spinnerStyle!!.setSelection(barIndex)

        // Retain Save button before window dismissal
        val saveBtn = dialog.getButton(android.content.DialogInterface.BUTTON_POSITIVE)
        assertNotNull(saveBtn)

        // 3. Deliver motion update (60 km/h)
        val intentMoving = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 60.0f)
        }
        method.invoke(activity, intentMoving, true)
        assertFalse(activity.isCockpitMutationPermitted())
        assertNull(dialogField.get(activity))

        // 4. If Save button was clicked after locking, idle looper for callback completion
        saveBtn!!.performClick()
        shadowOf(Looper.getMainLooper()).idle()

        // 5. Assert both active preset and stored slot remain unchanged
        assertEquals("Active preset must remain SPORT", DashboardPreset.SPORT, configManager.getActivePreset())
        val currentSlot0 = configManager.getMasterSlots(configManager.getActivePreset())[0]
        assertEquals(initialSlot0.metric, currentSlot0.metric)
        assertEquals(initialSlot0.style, currentSlot0.style)

        val fieldSlots = MainActivity::class.java.getDeclaredField("cockpitSlots").apply { isAccessible = true }
        val slots = fieldSlots.get(activity) as List<TelemetryWidgetView>
        assertEquals(initialSlot0.metric, slots[0].currentMetric)
        assertEquals(initialSlot0.style, slots[0].currentStyle)
    }

    @Test
    fun testInvalidAndMissingSpeedHandling() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val method = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }

        // Negative speed (-1f)
        val intentNeg = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", -1.0f)
        }
        method.invoke(activity, intentNeg, true)
        assertFalse(activity.isCockpitMutationPermitted())

        // Missing speed extra
        val intentMissing = Intent("com.example.obdapp.TELEMETRY_UPDATE")
        method.invoke(activity, intentMissing, true)
        assertFalse(activity.isCockpitMutationPermitted())

        // NaN speed
        val intentNan = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", Float.NaN)
        }
        method.invoke(activity, intentNan, true)
        assertFalse(activity.isCockpitMutationPermitted())

        // Infinity speed
        val intentInf = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", Float.POSITIVE_INFINITY)
        }
        method.invoke(activity, intentInf, true)
        assertFalse(activity.isCockpitMutationPermitted())
    }

    @Test
    fun testMockAndLiveTelemetryInterleaving() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val method = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }

        // Deliver live speed 60 km/h (isTrustedLive = true)
        val intentLiveMoving = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 60.0f)
        }
        method.invoke(activity, intentLiveMoving, true)
        activity.evaluateMotionState()
        assertFalse(activity.isCockpitMutationPermitted())

        // Deliver mock telemetry reporting 0 km/h (isTrustedLive = false)
        val intentMockStationary = Intent("com.example.obdapp.MOCK_TELEMETRY").apply {
            putExtra("speed", 0.0f)
        }
        method.invoke(activity, intentMockStationary, false)
        activity.evaluateMotionState()

        // Mock telemetry must NOT clear live movement holdoff
        assertFalse("Mock telemetry must not clear live movement holdoff", activity.isCockpitMutationPermitted())
        assertEquals(60.0f, MainActivity.lastValidLiveSpeedKmh ?: 0f, 0.01f)
        assertTrue(MainActivity.wasPreviouslyMoving)
    }

    @Test
    fun testActivityRecreationPreservesMovingHoldoff() {
        val controller1 = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity1 = controller1.get()
        val method1 = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }

        // Deliver trusted 60 km/h
        val intentMoving = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 60.0f)
        }
        method1.invoke(activity1, intentMoving, true)
        activity1.evaluateMotionState()
        assertFalse(activity1.isCockpitMutationPermitted())

        // Advance clock beyond freshness timeout (>6000ms)
        ShadowSystemClock.advanceBy(10, TimeUnit.SECONDS)
        activity1.evaluateMotionState()
        assertFalse("Stale speed must hold moving lock", activity1.isCockpitMutationPermitted())

        // Recreate the Activity
        controller1.destroy()
        val controller2 = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity2 = controller2.get()

        // Verified: holdoff is preserved across recreation!
        assertTrue(MainActivity.wasPreviouslyMoving)
        assertFalse("Activity recreation must retain moving holdoff", activity2.isCockpitMutationPermitted())

        // Starting demo mode afterward MUST NOT unlock editing without a real stationary sample
        activity2.startDemoMode()
        activity2.evaluateMotionState()
        assertFalse("Demo mode must NOT override moving holdoff", activity2.isCockpitMutationPermitted())

        // Delivering a real stationary reading (0 km/h) clears the holdoff and permits editing
        val method2 = MainActivity::class.java.getDeclaredMethod("handleTelemetryIntent", Intent::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
        val intentStationary = Intent("com.example.obdapp.TELEMETRY_UPDATE").apply {
            putExtra("speed", 0.0f)
        }
        method2.invoke(activity2, intentStationary, true)
        activity2.evaluateMotionState()
        assertTrue("Real stationary reading permits editing", activity2.isCockpitMutationPermitted())
        assertFalse(MainActivity.wasPreviouslyMoving)
    }
}
