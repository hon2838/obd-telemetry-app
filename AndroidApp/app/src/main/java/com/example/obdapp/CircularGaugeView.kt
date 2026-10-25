package com.example.obdapp

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
import androidx.core.content.ContextCompat
import kotlin.math.cos
import kotlin.math.sin

/**
 * High-performance, hardware-accelerated circular automotive dial gauge.
 * Features:
 * - 270° sweeping arc with calibrated tick marks and labels
 * - Tapered needle and central pivot hub
 * - Dynamic color transitions: nominal -> warning -> critical
 * - Peak hold memory marker
 * - Zero heap allocations inside onDraw() for rock-solid 60fps rendering
 * - Responsive dynamic scaling and adaptive tick decluttering across screen resolutions
 */
class CircularGaugeView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    var minValue: Float = 0f
        set(value) {
            if (!value.isFinite() || field == value) return
            field = value
            updateCachedTickLabels()
            updateFormattedValue()
            invalidate()
        }

    var maxValue: Float = 160f
        set(value) {
            if (!value.isFinite()) return
            val target = if (value > minValue) value else minValue + 1f
            if (field == target) return
            field = target
            updateCachedTickLabels()
            updateFormattedValue()
            invalidate()
        }

    var isAvailable: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            updateFormattedValue()
            invalidate()
        }

    var currentValue: Float = 0f
        set(value) {
            if (!value.isFinite()) return
            val clamped = value.coerceIn(minValue, maxValue)
            if (field == clamped && peakValue >= clamped && isAvailable) return
            field = clamped
            isAvailable = true
            if (field > peakValue) {
                peakValue = field
            }
            updateFormattedValue()
            invalidate()
        }

    private fun updateFormattedValue() {
        cachedFormattedValue = if (!isAvailable) {
            "N/A"
        } else if (currentValue == currentValue.toInt().toFloat()) {
            currentValue.toInt().toString()
        } else {
            String.format(java.util.Locale.US, "%.1f", currentValue)
        }
    }

    var peakValue: Float = 0f
        set(value) {
            if (!value.isFinite()) return
            val clamped = value.coerceIn(minValue, maxValue)
            if (field == clamped) return
            field = clamped
            invalidate()
        }

    var warningThreshold: Float = 120f
        set(value) {
            if (!value.isFinite() || field == value) return
            field = value
            invalidate()
        }

    var criticalThreshold: Float = 140f
        set(value) {
            if (!value.isFinite() || field == value) return
            field = value
            invalidate()
        }

    var title: String = "SPEED"
        set(value) {
            field = value
            invalidate()
        }

    var unit: String = "km/h"
        set(value) {
            field = value
            invalidate()
        }

    var majorTickInterval: Float = 20f
        set(value) {
            if (!value.isFinite() || field == value) return
            field = value
            updateCachedTickLabels()
            invalidate()
        }

    // Dynamic sizing & adaptive declutter parameters (computed in onSizeChanged)
    private var baseDiameter = 0f
    private var showTickLabels = true
    private var cachedTickValues: FloatArray = FloatArray(0)
    private var cachedTickLabels: Array<String> = emptyArray()
    private var cachedFormattedValue: String = "0"

    private fun updateCachedTickLabels() {
        val span = maxValue - minValue
        if (span <= 0f || !span.isFinite()) {
            cachedTickValues = FloatArray(0)
            cachedTickLabels = emptyArray()
            return
        }

        val rawInterval = if (majorTickInterval.isFinite() && majorTickInterval > 0f) {
            majorTickInterval
        } else {
            span / 8f
        }

        val maxTickCount = if (baseDiameter in 1f..219f) 20 else 40
        val maxIntervals = (maxTickCount - 2).coerceAtLeast(2)

        var effectiveInterval = rawInterval
        if (baseDiameter in 1f..219f && (span / effectiveInterval) > 5) {
            effectiveInterval *= 2f
        }
        while ((span / effectiveInterval) > maxIntervals) {
            effectiveInterval *= 2f
        }

        val valuesList = mutableListOf<Float>()
        var step = 0
        var tick = minValue
        val epsilon = effectiveInterval * 0.01f

        // Avoid floating-point accumulation drift:
        while (tick < maxValue - epsilon) {
            valuesList.add(tick)
            step++
            tick = minValue + (step * effectiveInterval)
        }

        // Always include the maximum endpoint
        if (valuesList.isEmpty()) {
            valuesList.add(minValue)
            valuesList.add(maxValue)
        } else if ((maxValue - valuesList.last()) > epsilon) {
            valuesList.add(maxValue)
        } else {
            valuesList[valuesList.size - 1] = maxValue
        }

        cachedTickValues = FloatArray(valuesList.size) { valuesList[it] }
        cachedTickLabels = Array(valuesList.size) { i ->
            val v = valuesList[i]
            if (kotlin.math.abs(v) >= 1000f) {
                val inK = v / 1000f
                if (inK == inK.toInt().toFloat()) {
                    inK.toInt().toString()
                } else {
                    String.format(java.util.Locale.US, "%.1f", inK)
                }
            } else {
                if (v == v.toInt().toFloat()) {
                    v.toInt().toString()
                } else {
                    String.format(java.util.Locale.US, "%.1f", v)
                }
            }
        }
    }

    // Theme-aware semantic colors
    private val colorCritical get() = ContextCompat.getColor(context, R.color.accent_red)
    private val colorWarning get() = ContextCompat.getColor(context, R.color.accent_amber)
    private val colorNormal get() = ContextCompat.getColor(context, R.color.accent_cyan)
    private val colorUnavailable get() = ContextCompat.getColor(context, R.color.text_muted)

    // Pre-allocated graphic objects
    private val arcBounds = RectF()
    private val needlePath = Path()

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = ContextCompat.getColor(context, R.color.gauge_track)
    }

    private val activeArcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = ContextCompat.getColor(context, R.color.accent_cyan)
    }

    private val tickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = ContextCompat.getColor(context, R.color.border_subtle)
    }

    private val majorTickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = ContextCompat.getColor(context, R.color.text_muted)
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        color = ContextCompat.getColor(context, R.color.text_muted)
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
    }

    private val unitTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        color = ContextCompat.getColor(context, R.color.text_secondary)
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
    }

    private val valueTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        color = ContextCompat.getColor(context, R.color.text_primary)
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }

    private val titleTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        color = ContextCompat.getColor(context, R.color.text_muted)
        letterSpacing = 0.08f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }

    private val needlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL_AND_STROKE
        color = ContextCompat.getColor(context, R.color.accent_red)
    }

    private val hubPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = ContextCompat.getColor(context, R.color.card_elevated)
    }

    private val hubStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f
        color = ContextCompat.getColor(context, R.color.border_subtle)
    }

    private val peakPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = ContextCompat.getColor(context, R.color.accent_amber)
    }

    private val startAngle = 135f
    private val sweepAngle = 270f

    fun resetPeak() {
        peakValue = currentValue
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val wAvail = (w - paddingLeft - paddingRight).coerceAtLeast(0)
        val hAvail = (h - paddingTop - paddingBottom).coerceAtLeast(0)
        val diameter = minOf(wAvail, hAvail).toFloat()
        baseDiameter = diameter
        if (diameter <= 0f) return

        // Proportional Stroke and Inset Scaling
        val stroke = (diameter * 0.085f).coerceIn(6f, 28f)
        val inset = (stroke / 2f) + (diameter * 0.04f)

        trackPaint.strokeWidth = stroke
        activeArcPaint.strokeWidth = stroke
        peakPaint.strokeWidth = stroke * 0.7f

        val cx = paddingLeft + (wAvail / 2f)
        val cy = paddingTop + (hAvail / 2f)
        val radius = ((diameter / 2f) - inset).coerceAtLeast(1f)
        arcBounds.set(cx - radius, cy - radius, cx + radius, cy + radius)

        // Dynamic Typography Scaling
        valueTextPaint.textSize = diameter * 0.26f
        unitTextPaint.textSize = maxOf(diameter * 0.09f, 11f)
        textPaint.textSize = diameter * 0.075f
        titleTextPaint.textSize = diameter * 0.085f

        baseDiameter = diameter
        showTickLabels = diameter >= 130f
        updateCachedTickLabels()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = arcBounds.centerX()
        val cy = arcBounds.centerY()
        val radius = arcBounds.width() / 2f
        if (radius <= 0) return

        // 1. Background Arc Track
        canvas.drawArc(arcBounds, startAngle, sweepAngle, false, trackPaint)

        // 2. Determine Color Zone based on current value (handles inverted thresholds & availability)
        val isLowCritical = criticalThreshold < warningThreshold
        val currentColor = if (!isAvailable) {
            colorUnavailable
        } else if (isLowCritical) {
            when {
                currentValue <= criticalThreshold -> colorCritical
                currentValue <= warningThreshold -> colorWarning
                else -> colorNormal
            }
        } else {
            when {
                currentValue >= criticalThreshold -> colorCritical
                currentValue >= warningThreshold -> colorWarning
                else -> colorNormal
            }
        }
        activeArcPaint.color = currentColor
        needlePaint.color = currentColor

        // 3. Active Progress Arc
        val progressFraction = if (isAvailable) {
            ((currentValue - minValue) / (maxValue - minValue)).coerceIn(0f, 1f)
        } else 0f
        val activeSweep = progressFraction * sweepAngle
        if (isAvailable && activeSweep > 0.5f) {
            canvas.drawArc(arcBounds, startAngle, activeSweep, false, activeArcPaint)
        }

        // 4. Adaptive Tick Marks (Consistent geometry and cached labels)
        val tickRadiusOuter = radius - (trackPaint.strokeWidth / 2f) - 3f
        val tickRadiusInnerMajor = tickRadiusOuter - (radius * 0.12f)
        val textRadius = tickRadiusInnerMajor - (radius * 0.14f)

        majorTickPaint.strokeWidth = (radius * 0.024f).coerceAtLeast(1.5f)

        val span = (maxValue - minValue).coerceAtLeast(0.0001f)
        for (i in cachedTickValues.indices) {
            val tickVal = cachedTickValues[i]
            val tickFrac = ((tickVal - minValue) / span).coerceIn(0f, 1f)
            val tickAngleDeg = startAngle + tickFrac * sweepAngle
            val tickAngleRad = Math.toRadians(tickAngleDeg.toDouble())

            val cosA = cos(tickAngleRad).toFloat()
            val sinA = sin(tickAngleRad).toFloat()

            val xStart = cx + tickRadiusInnerMajor * cosA
            val yStart = cy + tickRadiusInnerMajor * sinA
            val xEnd = cx + tickRadiusOuter * cosA
            val yEnd = cy + tickRadiusOuter * sinA

            canvas.drawLine(xStart, yStart, xEnd, yEnd, majorTickPaint)

            if (showTickLabels && i < cachedTickLabels.size) {
                val label = cachedTickLabels[i]
                val xText = cx + textRadius * cosA
                val yText = cy + textRadius * sinA + (textPaint.textSize * 0.35f)
                canvas.drawText(label, xText, yText, textPaint)
            }
        }

        // 5. Peak Hold Marker (amber tick)
        if (peakValue > minValue) {
            val peakFrac = ((peakValue - minValue) / (maxValue - minValue)).coerceIn(0f, 1f)
            val peakAngleDeg = startAngle + peakFrac * sweepAngle
            val peakRad = Math.toRadians(peakAngleDeg.toDouble())
            val cosP = cos(peakRad).toFloat()
            val sinP = sin(peakRad).toFloat()
            val pOuter = radius + (trackPaint.strokeWidth / 2f) + 2f
            val pInner = radius - (trackPaint.strokeWidth / 2f) - 2f
            canvas.drawLine(cx + pInner * cosP, cy + pInner * sinP, cx + pOuter * cosP, cy + pOuter * sinP, peakPaint)
        }

        // 6. Needle
        val needleLength = radius * 0.72f
        val needleAngleDeg = startAngle + progressFraction * sweepAngle
        val needleRad = Math.toRadians(needleAngleDeg.toDouble())
        val needlePerpRad = needleRad + Math.PI / 2.0

        val nCos = cos(needleRad).toFloat()
        val nSin = sin(needleRad).toFloat()
        val pCos = cos(needlePerpRad).toFloat()
        val pSin = sin(needlePerpRad).toFloat()

        val tipX = cx + needleLength * nCos
        val tipY = cy + needleLength * nSin
        val baseWidth = (radius * 0.055f).coerceAtLeast(2f)

        val leftBaseX = cx + baseWidth * pCos - (radius * 0.1f * nCos)
        val leftBaseY = cy + baseWidth * pSin - (radius * 0.1f * nSin)
        val rightBaseX = cx - baseWidth * pCos - (radius * 0.1f * nCos)
        val rightBaseY = cy - baseWidth * pSin - (radius * 0.1f * nSin)

        needlePath.reset()
        needlePath.moveTo(tipX, tipY)
        needlePath.lineTo(leftBaseX, leftBaseY)
        needlePath.lineTo(rightBaseX, rightBaseY)
        needlePath.close()

        canvas.drawPath(needlePath, needlePaint)

        // 7. Center Pivot Hub
        val hubRadius = (radius * 0.14f).coerceAtLeast(4f)
        canvas.drawCircle(cx, cy, hubRadius, hubPaint)
        canvas.drawCircle(cx, cy, hubRadius, hubStrokePaint)

        // 8. Digital Readout and Labels (Zero allocations from cache)
        val valueY = cy + (radius * 0.50f)
        canvas.drawText(cachedFormattedValue, cx, valueY, valueTextPaint)

        // Unit label below value
        canvas.drawText(unit, cx, valueY + (radius * 0.18f), unitTextPaint)

        // Title at upper center
        canvas.drawText(title, cx, cy - (radius * 0.42f), titleTextPaint)
    }
}
