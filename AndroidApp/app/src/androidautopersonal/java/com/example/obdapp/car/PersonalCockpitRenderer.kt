package com.example.obdapp.car

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Rect
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.example.obdapp.DisplayStyle
import com.example.obdapp.GatewayStatus
import com.example.obdapp.R
import com.example.obdapp.SpeedComparisonReading
import com.example.obdapp.TelemetryMetric
import com.example.obdapp.TelemetryWidgetView
import com.example.obdapp.TripFuelReading

/**
 * Isolated read-only automotive cockpit renderer for Android Auto personal sessions.
 * Draws telemetry gauges directly onto a host canvas without interactive controls,
 * background collector threads, or mutation callbacks.
 *
 * Main-thread use only.
 */
internal class PersonalCockpitRenderer(private val baseContext: Context) {

    internal var rootView: View? = null
        private set

    // Cached configuration to detect host-level geometry/environment changes
    private var lastWidth: Int = -1
    private var lastHeight: Int = -1
    private var lastDpi: Int = -1
    private var lastFontScale: Float = -1f
    private var lastVehicleId: String? = null

    // Direct slot references for fast telemetry updates
    private var slotSpeed: TelemetryWidgetView? = null       // widgetSlot0 (Speed dial)
    private var slotRpm: TelemetryWidgetView? = null         // widgetSlot1 (RPM dial)
    private var slotThrottle: TelemetryWidgetView? = null    // widgetSlot2 (Throttle bar)
    private var slotEngineLoad: TelemetryWidgetView? = null  // widgetSlot3 (Engine Load bar)
    private var slotCoolant: TelemetryWidgetView? = null     // widgetSlot4 (Coolant bar)
    private var slotIntakeTemp: TelemetryWidgetView? = null  // widgetSlot5 (Intake Temp bar)
    private var tvCockpitStatus: TextView? = null            // tvCockpitStatus
    private var cockpitStatusDot: View? = null               // cockpitStatusDot

    // Cumulative 5-minute trip reading retained across brief stopped/disconnected gaps
    private var retainedTripReading: TripFuelReading? = null

    companion object {
        private const val FRESH_SAMPLE_MAX_AGE_MS = 5_000L
        private const val STATUS_STOPPED = "Stopped"
        private const val STATUS_WAITING = "Waiting"
        private const val STATUS_CONNECTED = "Connected"
    }

    /**
     * Renders the full read-only cockpit onto [canvas] within [viewport].
     * Rebuilds view tree when viewport size, host dpi, accessibility font scale,
     * or active vehicle changes.
     */
    fun draw(
        canvas: Canvas,
        viewport: Rect,
        dpi: Int,
        status: GatewayStatus,
        activeVehicleId: String,
        nowElapsedMs: Long
    ) {
        val width = viewport.width()
        val height = viewport.height()
        if (width <= 0 || height <= 0 || dpi <= 0) return

        val currentFontScale = baseContext.resources.configuration.fontScale
        val vehicleChanged = activeVehicleId != lastVehicleId

        // On vehicle change, clear previous vehicle's historical trip reading and peak values
        if (vehicleChanged) {
            retainedTripReading = null
        }

        val needsRebuild = rootView == null ||
            width != lastWidth ||
            height != lastHeight ||
            dpi != lastDpi ||
            currentFontScale != lastFontScale ||
            vehicleChanged

        if (needsRebuild) {
            rebuildViewHierarchy(width, height, dpi, currentFontScale)
            lastWidth = width
            lastHeight = height
            lastDpi = dpi
            lastFontScale = currentFontScale
            lastVehicleId = activeVehicleId
        }

        val root = rootView ?: return

        // 1. Evaluate Freshness & State
        val isMatchingVehicle = activeVehicleId.isNotEmpty() && status.vehicleId == activeVehicleId
        val gauges = status.liveGauges

        val sampleElapsed = gauges?.sampledAtElapsedMs
        val isFresh = sampleElapsed != null && sampleElapsed >= 0L &&
            nowElapsedMs >= sampleElapsed && (nowElapsedMs - sampleElapsed) <= FRESH_SAMPLE_MAX_AGE_MS

        val isFreshRunningMatching = status.running && isMatchingVehicle && isFresh && gauges != null

        // 2. Update Header Status (Honest stopped / waiting / connected)
        val headerState = when {
            !status.running -> STATUS_STOPPED
            isFreshRunningMatching && status.adapterConnected -> STATUS_CONNECTED
            else -> STATUS_WAITING
        }

        val dotColorRes = when (headerState) {
            STATUS_CONNECTED -> R.color.accent_green
            STATUS_WAITING -> R.color.accent_amber
            else -> R.color.accent_red
        }

        tvCockpitStatus?.text = headerState
        cockpitStatusDot?.backgroundTintList = ColorStateList.valueOf(
            ContextCompat.getColor(root.context, dotColorRes)
        )

        // 3. Update Engine Gauges (Only fresh running matching-vehicle snapshots)
        if (isFreshRunningMatching && status.adapterConnected && gauges != null) {

            val rpmVal = gauges.rpm?.takeIf { it >= 0 }?.toDouble()
            slotRpm?.updateValue(rpmVal)

            val throttleVal = gauges.throttlePos?.takeIf { it in 0..100 }?.toDouble()
            slotThrottle?.updateValue(throttleVal)

            val loadVal = gauges.engineLoad?.takeIf { it in 0..100 }?.toDouble()
            slotEngineLoad?.updateValue(loadVal)

            val coolantVal = gauges.coolantTemp?.toDouble()
            slotCoolant?.updateValue(coolantVal)

            val intakeVal = gauges.intakeAirTemp?.toDouble()
            slotIntakeTemp?.updateValue(intakeVal)
        } else {
            slotSpeed?.setUnavailable()
            slotRpm?.setUnavailable()
            slotThrottle?.setUnavailable()
            slotEngineLoad?.setUnavailable()
            slotCoolant?.setUnavailable()
            slotIntakeTemp?.setUnavailable()
        }

        // 4. Update Speed Comparison Row (Independent GPS/OBD sensor timestamps via SpeedComparisonReading)
        val comparison = if (status.running && isMatchingVehicle && gauges != null) {
            val reading = SpeedComparisonReading(
                vehicleId = activeVehicleId,
                obdKmh = gauges.obdSpeedKmh.takeIf { status.adapterConnected },
                obdAtElapsedMs = gauges.obdSpeedAtElapsedMs ?: -1L,
                gpsKmh = gauges.gpsSpeedKmh,
                gpsAtElapsedMs = gauges.gpsSpeedAtElapsedMs ?: -1L
            )
            reading.current(activeVehicleId, nowElapsedMs)
        } else {
            SpeedComparisonReading.Values()
        }

        val primarySpeed = comparison.obdKmh ?: comparison.gpsKmh
        val primarySource = if (comparison.obdKmh != null) "OBD" else if (comparison.gpsKmh != null) "GPS" else ""
        slotSpeed?.updateValue(primarySpeed?.toDouble())
        slotSpeed?.updateSpeedComparison(comparison.gpsKmh, comparison.differenceKmh, primarySource)

        // 5. Update Throttle Supplemental Rows (Instantaneous Economy, Rate & Cumulative Trip Average)
        if (isFreshRunningMatching && status.adapterConnected && gauges != null) {
            val instEconomy = gauges.fuelEconomyKmL?.takeIf { it.isFinite() && it >= 0.0 }
            val fuelRate = gauges.fuelRateLph?.takeIf { it.isFinite() && it >= 0.0 }
            slotThrottle?.updateFuelEconomy(instEconomy)
            slotThrottle?.updateFuelRate(fuelRate)
        } else {
            slotThrottle?.updateFuelEconomy(null)
            slotThrottle?.updateFuelRate(null)
        }

        // Cumulative history keeps its original clock and ignores delayed older snapshots.
        if (status.running && isMatchingVehicle && gauges != null) {
            val tripTime = gauges.tripSampledAtElapsedMs
            val coverage = gauges.tripCoverageRatio
            val economy = gauges.tripEconomyKmL
            if (tripTime != null && coverage != null &&
                (economy == null || economy.isFinite() && economy in 0.0..1_000_000.0)) {
                val candidate = TripFuelReading(activeVehicleId, economy, coverage, tripTime)
                    .current(activeVehicleId, nowElapsedMs)
                val previous = retainedTripReading?.current(activeVehicleId, nowElapsedMs)
                if (candidate != null && (previous == null || candidate.sampledAtElapsedMs >= previous.sampledAtElapsedMs)) {
                    retainedTripReading = candidate
                }
            }
        }

        // Check 5-minute cumulative validity
        val currentTrip = retainedTripReading?.current(activeVehicleId, nowElapsedMs)
        if (currentTrip == null) {
            retainedTripReading = null
            slotThrottle?.updateTripFuelEconomy(null, null, paused = false)
        } else {
            val isPaused = headerState != STATUS_CONNECTED || nowElapsedMs - currentTrip.sampledAtElapsedMs > FRESH_SAMPLE_MAX_AGE_MS
            slotThrottle?.updateTripFuelEconomy(
                economyKmL = currentTrip.economyKmL,
                coverageRatio = currentTrip.coverageRatio,
                paused = isPaused
            )
        }

        // 6. Measure & Layout
        val widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
        val heightSpec = View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
        root.measure(widthSpec, heightSpec)
        root.layout(0, 0, width, height)

        // 7. Render to Canvas with Viewport Translation and Clipping
        canvas.save()
        try {
            canvas.clipRect(viewport)
            canvas.translate(viewport.left.toFloat(), viewport.top.toFloat())
            root.draw(canvas)
        } finally {
            canvas.restore()
        }
    }

    private fun rebuildViewHierarchy(width: Int, height: Int, dpi: Int, fontScale: Float) {
        val config = Configuration(baseContext.resources.configuration).apply {
            densityDpi = dpi
            this.fontScale = fontScale
        }
        val hostContext = baseContext.createConfigurationContext(config)
        val themedContext = ContextThemeWrapper(hostContext, R.style.Theme_OBDGateway)
        val density = themedContext.resources.displayMetrics.density

        val root = LinearLayout(themedContext).apply {
            id = R.id.cockpitRoot
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ContextCompat.getColor(themedContext, R.color.background))
            isClickable = false
            isFocusable = false
        }

        // Status Header
        val header = LinearLayout(themedContext).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val padH = (10 * density).toInt().coerceAtLeast(4)
            val padV = (4 * density).toInt().coerceAtLeast(2)
            setPadding(padH, padV, padH, padV)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            isClickable = false
            isFocusable = false
        }

        val dot = View(themedContext).apply {
            id = R.id.cockpitStatusDot
            val dotPx = (8 * density).toInt().coerceAtLeast(6)
            layoutParams = LinearLayout.LayoutParams(dotPx, dotPx).apply {
                rightMargin = (6 * density).toInt().coerceAtLeast(4)
            }
            setBackgroundResource(R.drawable.circle_indicator)
            backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(themedContext, R.color.accent_red)
            )
            isClickable = false
            isFocusable = false
        }
        cockpitStatusDot = dot
        header.addView(dot)

        val tvStatus = TextView(themedContext).apply {
            id = R.id.tvCockpitStatus
            textSize = 12f
            setTextColor(ContextCompat.getColor(themedContext, R.color.text_primary))
            text = STATUS_STOPPED
            isClickable = false
            isFocusable = false
        }
        tvCockpitStatus = tvStatus
        header.addView(tvStatus)

        root.addView(header)

        // Read-only Telemetry Slots
        fun makeSlot(idRes: Int, metric: TelemetryMetric, style: DisplayStyle): TelemetryWidgetView {
            return TelemetryWidgetView(themedContext).apply {
                id = idRes
                bindMetric(metric, style)
                isClickable = false
                isFocusable = false
                canMutateCockpit = { false }
                onStyleChangedListener = null
                onEditRequestedListener = null
                onDoubleTapListener = null
            }
        }

        val slot0 = makeSlot(R.id.widgetSlot0, TelemetryMetric.SPEED, DisplayStyle.DIAL)
        val slot1 = makeSlot(R.id.widgetSlot1, TelemetryMetric.RPM, DisplayStyle.DIAL)
        val slot2 = makeSlot(R.id.widgetSlot2, TelemetryMetric.THROTTLE, DisplayStyle.BAR)
        val slot3 = makeSlot(R.id.widgetSlot3, TelemetryMetric.ENGINE_LOAD, DisplayStyle.BAR)
        val slot4 = makeSlot(R.id.widgetSlot4, TelemetryMetric.COOLANT, DisplayStyle.BAR)
        val slot5 = makeSlot(R.id.widgetSlot5, TelemetryMetric.INTAKE_TEMP, DisplayStyle.BAR)

        slotSpeed = slot0
        slotRpm = slot1
        slotThrottle = slot2
        slotEngineLoad = slot3
        slotCoolant = slot4
        slotIntakeTemp = slot5

        val marginPx = (3 * density).toInt().coerceAtLeast(2)
        fun slotParams(weight: Float): LinearLayout.LayoutParams {
            return LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, weight).apply {
                setMargins(marginPx, marginPx, marginPx, marginPx)
            }
        }

        val isPortrait = height > width
        val gridContainer = LinearLayout(themedContext).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
            isClickable = false
            isFocusable = false
        }

        if (isPortrait) {
            // Adapt portrait to 2 columns / 3 rows
            val row1 = LinearLayout(themedContext).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.25f)
                addView(slot0, slotParams(1f))
                addView(slot1, slotParams(1f))
            }
            val row2 = LinearLayout(themedContext).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.0f)
                addView(slot2, slotParams(1f))
                addView(slot3, slotParams(1f))
            }
            val row3 = LinearLayout(themedContext).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 0.9f)
                addView(slot4, slotParams(1f))
                addView(slot5, slotParams(1f))
            }
            gridContainer.addView(row1)
            gridContainer.addView(row2)
            gridContainer.addView(row3)
        } else {
            // Landscape 2x3 layout:
            // speed left dial, throttle middle bar, RPM right dial;
            // bottom engine load / coolant / intake temp bars
            val row1 = LinearLayout(themedContext).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.25f)
                addView(slot0, slotParams(1.05f))
                addView(slot2, slotParams(0.9f))
                addView(slot1, slotParams(1.05f))
            }
            val row2 = LinearLayout(themedContext).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 0.75f)
                addView(slot3, slotParams(1f))
                addView(slot4, slotParams(1f))
                addView(slot5, slotParams(1f))
            }
            gridContainer.addView(row1)
            gridContainer.addView(row2)
        }

        root.addView(gridContainer)
        rootView = root
    }
}
