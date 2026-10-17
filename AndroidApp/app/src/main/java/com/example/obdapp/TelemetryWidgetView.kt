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
        if (!isMetricAvailable) {
            setUnavailable()
        } else if (hasReceivedValue) {
            syncEffectiveStyleValue()
        }
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
