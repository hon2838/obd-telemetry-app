package com.example.obdapp

import android.content.Context
import android.util.AttributeSet
import android.view.GestureDetector
import android.view.HapticFeedbackConstants
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

enum class DisplayStyle(val displayName: String) {
    DIAL("Dial Gauge"),
    BAR("Linear Bar"),
    DIGITAL("Digital HUD"),
    GRAPH("Live Waveform")
}

enum class TelemetryMetric(
    val id: String,
    val displayName: String,
    val unit: String,
    val minVal: Float,
    val maxVal: Float,
    val warnThresh: Float,
    val critThresh: Float,
    val defaultStyle: DisplayStyle
) {
    SPEED("speed", "SPEED", "km/h", 0f, 220f, 120f, 160f, DisplayStyle.DIAL),
    RPM("rpm", "ENGINE RPM", "RPM", 0f, 8000f, 6000f, 7000f, DisplayStyle.DIAL),
    COOLANT("coolant", "COOLANT", "°C", 0f, 130f, 100f, 115f, DisplayStyle.BAR),
    BATTERY("battery", "BATTERY", "V", 9f, 16f, 14.8f, 15.2f, DisplayStyle.BAR),
    THROTTLE("throttle", "THROTTLE", "%", 0f, 100f, 85f, 95f, DisplayStyle.BAR),
    FUEL_LEVEL("fuel_level", "FUEL LEVEL", "%", 0f, 100f, 15f, 8f, DisplayStyle.BAR),
    ENGINE_LOAD("engine_load", "ENGINE LOAD", "%", 0f, 100f, 80f, 95f, DisplayStyle.BAR),
    INTAKE_TEMP("intake_temp", "INTAKE TEMP", "°C", -20f, 100f, 60f, 75f, DisplayStyle.BAR),
    FUEL_ECONOMY("fuel_economy", "FUEL ECON", "km/L", 0f, 30f, 5f, 3f, DisplayStyle.DIGITAL),
    FUEL_RATE("fuel_rate", "FUEL RATE", "L/h", 0f, 30f, 20f, 25f, DisplayStyle.DIGITAL),
    GPS_ALTITUDE("altitude", "ALTITUDE", "m", -50f, 3000f, 2500f, 2800f, DisplayStyle.DIGITAL),
    TIMING_ADVANCE("timing", "TIMING", "°", -20f, 60f, 45f, 55f, DisplayStyle.DIGITAL),
    MANIFOLD_PRESSURE("map", "MANIFOLD PRESS", "kPa", 0f, 255f, 180f, 220f, DisplayStyle.BAR),
    MASS_AIR_FLOW("maf", "MASS AIR FLOW", "g/s", 0f, 250f, 180f, 220f, DisplayStyle.DIGITAL)
}

/**
 * Polymorphic automotive telemetry container.
 * Features:
 * - Whole-card gesture recognition (Single Tap cycle, Double Tap HUD zoom, Long Press edit)
 * - Auto-morph clamping on vertically constrained displays (h < 110dp morphs DIAL to BAR)
 * - Proportional typography and element scaling across 7" to 15.6" screens
 */
class TelemetryWidgetView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    private val dialView: CircularGaugeView
    private val barView: LinearBarGaugeView
    private val digitalContainer: View
    private val tvDigitalTitle: TextView
    private val tvDigitalValue: TextView
    private val tvDigitalUnit: TextView
    private val tvDigitalMinMax: TextView
    private val digitalSparkline: SparklineView
    private val graphContainer: View
    private val tvGraphTitle: TextView
    private val tvGraphValue: TextView
    private val graphSparkline: SparklineView
    private val throttleFuelEconomyRow: View
    private val tvThrottleFuelEconomy: TextView
    private val throttleFuelRateRow: View
    private val tvThrottleFuelRate: TextView
    private val speedComparisonRow: TextView
    private val throttleTripFuelRow: View
    private val tvThrottleTripFuel: TextView
    private val tvTripFuelQuality: TextView

    var currentMetric: TelemetryMetric = TelemetryMetric.SPEED
        private set

    /** The user's saved/preferred display style */
    var currentStyle: DisplayStyle = DisplayStyle.DIAL
        private set

    /** Effective display style rendered after applying height constraints */
    private var effectiveStyle: DisplayStyle = DisplayStyle.DIAL

    private var sessionMin: Double = Double.MAX_VALUE
    private var sessionMax: Double = -Double.MAX_VALUE
    private var currentValue: Double = 0.0
    private var hasReceivedValue: Boolean = false
    private var isInitialized: Boolean = false
    var isMetricAvailable: Boolean = false
        private set

    var onStyleChangedListener: ((DisplayStyle) -> Unit)? = null
    var onEditRequestedListener: (() -> Unit)? = null
    var onDoubleTapListener: (() -> Unit)? = null
    var canMutateCockpit: (() -> Boolean)? = null

    private val gestureDetector: GestureDetector

    init {
        isClickable = true
        isFocusable = true

        LayoutInflater.from(context).inflate(R.layout.view_telemetry_widget, this, true)

        dialView = findViewById(R.id.dialGaugeView)
        barView = findViewById(R.id.barGaugeView)
        digitalContainer = findViewById(R.id.digitalHudContainer)
        tvDigitalTitle = findViewById(R.id.tvDigitalTitle)
        tvDigitalValue = findViewById(R.id.tvDigitalValue)
        tvDigitalUnit = findViewById(R.id.tvDigitalUnit)
        tvDigitalMinMax = findViewById(R.id.tvDigitalMinMax)
        digitalSparkline = findViewById(R.id.digitalSparkline)

        graphContainer = findViewById(R.id.graphContainer)
        tvGraphTitle = findViewById(R.id.tvGraphTitle)
        tvGraphValue = findViewById(R.id.tvGraphValue)
        graphSparkline = findViewById(R.id.graphSparkline)
        throttleFuelEconomyRow = findViewById(R.id.throttleFuelEconomyRow)
        tvThrottleFuelEconomy = findViewById(R.id.tvThrottleFuelEconomy)
        throttleFuelRateRow = findViewById(R.id.throttleFuelRateRow)
        tvThrottleFuelRate = findViewById(R.id.tvThrottleFuelRate)
        speedComparisonRow = findViewById(R.id.speedComparisonRow)
        throttleTripFuelRow = findViewById(R.id.throttleTripFuelRow)
        tvThrottleTripFuel = findViewById(R.id.tvThrottleTripFuel)
        tvTripFuelQuality = findViewById(R.id.tvTripFuelQuality)
        updateTripFuelEconomy(null, null)
        updateFuelEconomy(null)
        updateFuelRate(null)
        updateSpeedComparison(null, null, "")

        // Automotive gesture detector for whole-card touch ergonomics
        gestureDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                return performClick()
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onDoubleTapListener?.invoke()
                return true
            }

            override fun onLongPress(e: MotionEvent) {
                if (canMutateCockpit?.invoke() != false) {
                    performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    onEditRequestedListener?.invoke()
                }
            }
        })

        bindMetric(currentMetric, currentStyle)
    }

    override fun performClick(): Boolean {
        if (canMutateCockpit?.invoke() == false) {
            return false
        }
        super.performClick()
        cycleStyle()
        return true
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val handled = gestureDetector.onTouchEvent(event)
        return handled || super.onTouchEvent(event)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // Decide before measuring the weighted content, so the first layout
        // reserves height for this row instead of measuring it while GONE.
        updateFuelRowVisibility(MeasureSpec.getSize(heightMeasureSpec))
        updateSpeedRowVisibility(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w <= 0 || h <= 0) return

        val density = resources.displayMetrics.density
        val hDp = h / density

        // Auto-Morph Clamping: When slot height is constrained (<110dp), morph DIAL to BAR
        val targetEffective = if (hDp < 110f && currentStyle == DisplayStyle.DIAL) {
            DisplayStyle.BAR
        } else {
            currentStyle
        }

        if (targetEffective != effectiveStyle) {
            effectiveStyle = targetEffective
            applyStyleVisibility()
        }

        // Proportional Digital HUD & Waveform Typography Scaling
        val digitalValSp = (minOf(h * 0.40f, w * 0.22f) / density).coerceIn(16f, 38f)
        val titleSp = ((h * 0.12f) / density).coerceIn(9f, 15f)
        val unitSp = ((h * 0.14f) / density).coerceIn(10f, 18f)
        val subSp = ((h * 0.09f) / density).coerceIn(8f, 13f)

        tvDigitalTitle.textSize = titleSp
        tvDigitalValue.textSize = digitalValSp
        tvDigitalUnit.textSize = unitSp
        tvDigitalMinMax.textSize = subSp

        tvGraphTitle.textSize = titleSp
        tvGraphValue.textSize = unitSp
        updateFuelRowVisibility()
        updateSpeedRowVisibility()
    }

    fun bindMetric(metric: TelemetryMetric, style: DisplayStyle? = null) {
        val targetStyle = style ?: metric.defaultStyle
        if (isInitialized && currentMetric == metric) {
            // Reconciling layout/preset with same metric: preserve live readings, session extrema,
            // sparkline history, and availability. Apply style silently.
            setStyle(targetStyle, notifyUserChange = false)
            return
        }

        isInitialized = true
        this.currentMetric = metric
        this.currentStyle = targetStyle

        val density = resources.displayMetrics.density
        val hDp = if (height > 0) height / density else 200f
        this.effectiveStyle = if (hDp < 110f && targetStyle == DisplayStyle.DIAL) {
            DisplayStyle.BAR
        } else {
            targetStyle
        }

        // Configure Dial
        dialView.title = metric.displayName
        dialView.unit = metric.unit
        dialView.minValue = metric.minVal
        dialView.maxValue = metric.maxVal
        dialView.currentValue = metric.minVal
        dialView.peakValue = metric.minVal
        dialView.warningThreshold = metric.warnThresh
        dialView.criticalThreshold = metric.critThresh
        dialView.majorTickInterval = when {
            metric.maxVal >= 5000 -> 1000f
            metric.maxVal >= 100 -> 20f
            else -> 10f
        }

        // Configure Bar
        barView.title = metric.displayName
        barView.unit = metric.unit
        barView.minValue = metric.minVal
        barView.maxValue = metric.maxVal
        barView.currentValue = metric.minVal
        barView.warningThreshold = metric.warnThresh
        barView.criticalThreshold = metric.critThresh

        // Configure Digital
        tvDigitalTitle.text = metric.displayName
        tvDigitalUnit.text = metric.unit

        // Configure Graph
        tvGraphTitle.text = metric.displayName

        // Theme-aware instrument accents: speed uses accent_cyan, others accent_blue
        val isSpeed = metric == TelemetryMetric.SPEED
        val accentColor = ContextCompat.getColor(
            context,
            if (isSpeed) R.color.accent_cyan else R.color.accent_blue
        )
        tvDigitalUnit.setTextColor(accentColor)
        tvGraphValue.setTextColor(accentColor)

        // Clear history and show unavailable until a sample arrives
        sessionMin = Double.MAX_VALUE
        sessionMax = -Double.MAX_VALUE
        currentValue = metric.minVal.toDouble()
        hasReceivedValue = false
        digitalSparkline.clear()
        graphSparkline.clear()

        setUnavailable()
        applyStyleVisibility()
    }

    fun setStyle(style: DisplayStyle, notifyUserChange: Boolean = true) {
        if (currentStyle != style) {
            currentStyle = style
            val density = resources.displayMetrics.density
            val hDp = if (height > 0) height / density else 200f
            effectiveStyle = if (hDp < 110f && style == DisplayStyle.DIAL) {
                DisplayStyle.BAR
            } else {
                style
            }
            applyStyleVisibility()
            if (notifyUserChange) {
                onStyleChangedListener?.invoke(currentStyle)
            }
        }
    }

    fun cycleStyle() {
        val styles = DisplayStyle.values()
        val nextIndex = (currentStyle.ordinal + 1) % styles.size
        setStyle(styles[nextIndex], notifyUserChange = true)
    }

    private fun applyStyleVisibility() {
        dialView.visibility = if (effectiveStyle == DisplayStyle.DIAL) View.VISIBLE else View.GONE
        barView.visibility = if (effectiveStyle == DisplayStyle.BAR) View.VISIBLE else View.GONE
        digitalContainer.visibility = if (effectiveStyle == DisplayStyle.DIGITAL) View.VISIBLE else View.GONE
        graphContainer.visibility = if (effectiveStyle == DisplayStyle.GRAPH) View.VISIBLE else View.GONE
        updateFuelRowVisibility()
        updateSpeedRowVisibility()
        if (!isMetricAvailable) {
            setUnavailable()
        } else if (hasReceivedValue) {
            syncEffectiveStyleValue()
        }
    }

    private fun updateFuelRowVisibility(availableHeightPx: Int = height) {
        val hDp = availableHeightPx / resources.displayMetrics.density
        // Leave space for the primary bar and respect larger accessibility fonts.
        val minHeightDp = 120f + 80f * resources.configuration.fontScale
        throttleFuelEconomyRow.visibility = if (currentMetric == TelemetryMetric.THROTTLE &&
            effectiveStyle == DisplayStyle.BAR && hDp >= minHeightDp) View.VISIBLE else View.GONE
        val tripVisible = currentMetric == TelemetryMetric.THROTTLE &&
            effectiveStyle == DisplayStyle.BAR && hDp >= 180f + 130f * resources.configuration.fontScale
        throttleTripFuelRow.visibility = if (tripVisible) View.VISIBLE else View.GONE
        // Preserve trip economy first; the optional instantaneous rate uses remaining room.
        val rateMinHeightDp = if (tripVisible) 230f + 125f * resources.configuration.fontScale
            else 180f + 130f * resources.configuration.fontScale
        throttleFuelRateRow.visibility = if (currentMetric == TelemetryMetric.THROTTLE &&
            effectiveStyle == DisplayStyle.BAR && hDp >= rateMinHeightDp) View.VISIBLE else View.GONE
    }

    private fun updateSpeedRowVisibility(availableWidthPx: Int = width, availableHeightPx: Int = height) {
        val density = resources.displayMetrics.density
        val fontScale = resources.configuration.fontScale
        speedComparisonRow.visibility = if (currentMetric == TelemetryMetric.SPEED &&
            effectiveStyle == DisplayStyle.DIAL && availableHeightPx / density >= 320f &&
            availableWidthPx / density >= 300f * fontScale && fontScale <= 1.3f) View.VISIBLE else View.GONE
    }

    fun updateSpeedComparison(gpsKmh: Float?, differenceKmh: Float?, primarySource: String) {
        fun format(value: Float?, signed: Boolean): String = value?.takeIf { it.isFinite() }?.let {
            val roundedZero = if (kotlin.math.abs(it) < 0.05f) 0f else it
            String.format(java.util.Locale.getDefault(), if (signed) "%+.1f" else "%.1f", roundedZero)
        } ?: "—"
        val gps = format(gpsKmh?.takeIf { it >= 0f }, false)
        val difference = format(differenceKmh, true)
        val text = context.getString(R.string.speed_comparison, gps, difference)
        if (speedComparisonRow.text.toString() != text) speedComparisonRow.text = text
        speedComparisonRow.contentDescription = context.getString(R.string.speed_comparison_description, gps, difference)
        if (currentMetric == TelemetryMetric.SPEED) {
            val title = when (primarySource) {
                "OBD" -> context.getString(R.string.vehicle_speed_title)
                "GPS" -> context.getString(R.string.gps_speed_title)
                else -> currentMetric.displayName
            }
            if (dialView.title != title) dialView.title = title
        }
    }

    fun updateFuelRate(rateLph: Double?) {
        val valid = rateLph?.takeIf { it.isFinite() && it >= 0.0 }
        val value = valid?.let { String.format(java.util.Locale.getDefault(), "%.1f", it) } ?: "—"
        if (tvThrottleFuelRate.text.toString() != value) tvThrottleFuelRate.text = value
        tvThrottleFuelRate.setTextColor(ContextCompat.getColor(
            context, if (valid != null) R.color.text_primary else R.color.text_secondary
        ))
        throttleFuelRateRow.contentDescription = context.getString(R.string.fuel_rate_readout_description, value)
    }

    fun updateTripFuelEconomy(economyKmL: Double?, coverageRatio: Double?, paused: Boolean = false) {
        val value = economyKmL?.takeIf { it.isFinite() && it in 0.0..1_000_000.0 }
            ?.let { String.format(java.util.Locale.getDefault(), "%.1f", it) } ?: "—"
        val coverage = coverageRatio?.takeIf { it.isFinite() && it in 0.0..1.0 }
        val quality = if (value == "—" || coverage == null) context.getString(R.string.trip_fuel_waiting)
            else context.getString(if (paused) R.string.trip_fuel_paused else R.string.trip_fuel_quality,
                (coverage * 100).toInt())
        if (tvThrottleTripFuel.text.toString() != value) tvThrottleTripFuel.text = value
        if (tvTripFuelQuality.text.toString() != quality) tvTripFuelQuality.text = quality
        val description = context.getString(R.string.trip_fuel_description, value, quality)
        if (throttleTripFuelRow.contentDescription != description) throttleTripFuelRow.contentDescription = description
        updateFuelRowVisibility()
    }

    fun updateFuelEconomy(economyKmL: Double?) {
        val valid = economyKmL?.takeIf { it.isFinite() && it >= 0.0 }
        val value = valid?.let { String.format(java.util.Locale.getDefault(), "%.1f", it) } ?: "N/A"
        tvThrottleFuelEconomy.text = value
        tvThrottleFuelEconomy.setTextColor(ContextCompat.getColor(
            context, if (valid != null) R.color.text_primary else R.color.text_secondary
        ))
        throttleFuelEconomyRow.contentDescription = context.getString(R.string.fuel_economy_readout_description, value)
    }

    private fun syncEffectiveStyleValue() {
        val fVal = currentValue.toFloat()
        when (effectiveStyle) {
            DisplayStyle.DIAL -> dialView.currentValue = fVal
            DisplayStyle.BAR -> barView.currentValue = fVal
            DisplayStyle.DIGITAL -> {
                val formatted = if (currentValue == currentValue.toInt().toDouble()) {
                    currentValue.toInt().toString()
                } else {
                    String.format(java.util.Locale.US, "%.1f", currentValue)
                }
                tvDigitalValue.text = formatted
                tvDigitalMinMax.text = String.format(
                    java.util.Locale.US,
                    "Min: %.1f  |  Max: %.1f",
                    sessionMin,
                    sessionMax
                )
            }
            DisplayStyle.GRAPH -> {
                val formatted = if (currentValue == currentValue.toInt().toDouble()) {
                    "${currentValue.toInt()} ${currentMetric.unit}"
                } else {
                    String.format(java.util.Locale.US, "%.1f %s", currentValue, currentMetric.unit)
                }
                tvGraphValue.text = formatted
            }
        }
    }

    fun setUnavailable() {
        isMetricAvailable = false
        dialView.isAvailable = false
        barView.isAvailable = false
        tvDigitalValue.text = "N/A"
        tvDigitalMinMax.text = "--"
        tvGraphValue.text = "N/A"
    }

    fun updateValue(value: Double?) {
        if (value == null || !value.isFinite()) {
            setUnavailable()
            return
        }
        this.isMetricAvailable = true
        this.hasReceivedValue = true
        dialView.isAvailable = true
        barView.isAvailable = true
        this.currentValue = value
        val fVal = value.toFloat()

        if (value < sessionMin) sessionMin = value
        if (value > sessionMax) sessionMax = value

        when (effectiveStyle) {
            DisplayStyle.DIAL -> {
                dialView.currentValue = fVal
            }
            DisplayStyle.BAR -> {
                barView.currentValue = fVal
            }
            DisplayStyle.DIGITAL -> {
                val formatted = if (value == value.toInt().toDouble()) {
                    value.toInt().toString()
                } else {
                    String.format(java.util.Locale.US, "%.1f", value)
                }
                tvDigitalValue.text = formatted
                tvDigitalMinMax.text = String.format(
                    java.util.Locale.US,
                    "Min: %.1f  |  Max: %.1f",
                    sessionMin,
                    sessionMax
                )
                digitalSparkline.push(null, fVal)
            }
            DisplayStyle.GRAPH -> {
                val formatted = if (value == value.toInt().toDouble()) {
                    "${value.toInt()} ${currentMetric.unit}"
                } else {
                    String.format(java.util.Locale.US, "%.1f %s", value, currentMetric.unit)
                }
                tvGraphValue.text = formatted
                graphSparkline.push(null, fVal)
            }
        }
    }
}
