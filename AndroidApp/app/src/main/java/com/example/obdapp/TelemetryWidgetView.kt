package com.example.obdapp

import android.content.Context
import android.util.AttributeSet
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageButton
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
 * Polymorphic telemetry container allowing the user to view any metric
 * as a Radial Dial, Linear Bar, Digital HUD card, or Live Waveform.
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
    private val btnCycleFormat: ImageButton

    var currentMetric: TelemetryMetric = TelemetryMetric.SPEED
        private set

    var currentStyle: DisplayStyle = DisplayStyle.DIAL
        private set

    private var sessionMin: Double = Double.MAX_VALUE
    private var sessionMax: Double = Double.MIN_VALUE
    private var currentValue: Double = 0.0

    var onStyleChangedListener: ((DisplayStyle) -> Unit)? = null
    var onEditRequestedListener: (() -> Unit)? = null

    init {
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

        btnCycleFormat = findViewById(R.id.btnCycleFormat)
        btnCycleFormat.setOnClickListener {
            cycleStyle()
        }

        setOnLongClickListener {
            onEditRequestedListener?.invoke()
            true
        }

        // Initialize with default metric and style
        bindMetric(currentMetric, currentStyle)
    }

    fun bindMetric(metric: TelemetryMetric, style: DisplayStyle? = null) {
        this.currentMetric = metric
        val targetStyle = style ?: metric.defaultStyle
        this.currentStyle = targetStyle

        // Configure Dial
        dialView.title = metric.displayName
        dialView.unit = metric.unit
        dialView.minValue = metric.minVal
        dialView.maxValue = metric.maxVal
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
        barView.warningThreshold = metric.warnThresh
        barView.criticalThreshold = metric.critThresh

        // Configure Digital
        tvDigitalTitle.text = metric.displayName
        tvDigitalUnit.text = metric.unit

        // Configure Graph
        tvGraphTitle.text = metric.displayName

        sessionMin = Double.MAX_VALUE
        sessionMax = Double.MIN_VALUE

        applyStyleVisibility()
    }

    fun setStyle(style: DisplayStyle) {
        if (currentStyle != style) {
            currentStyle = style
            applyStyleVisibility()
            onStyleChangedListener?.invoke(currentStyle)
        }
    }

    fun cycleStyle() {
        val styles = DisplayStyle.values()
        val nextIndex = (currentStyle.ordinal + 1) % styles.size
        setStyle(styles[nextIndex])
    }

    private fun applyStyleVisibility() {
        dialView.visibility = if (currentStyle == DisplayStyle.DIAL) View.VISIBLE else View.GONE
        barView.visibility = if (currentStyle == DisplayStyle.BAR) View.VISIBLE else View.GONE
        digitalContainer.visibility = if (currentStyle == DisplayStyle.DIGITAL) View.VISIBLE else View.GONE
        graphContainer.visibility = if (currentStyle == DisplayStyle.GRAPH) View.VISIBLE else View.GONE
    }

    fun updateValue(value: Double) {
        this.currentValue = value
        val fVal = value.toFloat()

        if (value < sessionMin) sessionMin = value
        if (value > sessionMax) sessionMax = value

        when (currentStyle) {
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
