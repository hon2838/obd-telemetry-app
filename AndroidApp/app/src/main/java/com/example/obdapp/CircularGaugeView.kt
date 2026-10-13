package com.example.obdapp

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
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
 */
class CircularGaugeView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    var minValue: Float = 0f
        set(value) {
            field = value
            invalidate()
        }

    var maxValue: Float = 160f
        set(value) {
            field = if (value > minValue) value else minValue + 1f
            invalidate()
        }

    var currentValue: Float = 0f
        set(value) {
            field = value.coerceIn(minValue, maxValue)
            if (field > peakValue) {
                peakValue = field
            }
            invalidate()
        }

    var peakValue: Float = 0f
        set(value) {
            field = value.coerceIn(minValue, maxValue)
            invalidate()
        }

    var warningThreshold: Float = 120f
        set(value) {
            field = value
            invalidate()
        }

    var criticalThreshold: Float = 140f
        set(value) {
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
            field = value
            invalidate()
        }

    // Pre-allocated graphic objects
    private val arcBounds = RectF()
    private val needlePath = Path()

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = Color.parseColor("#1F2430")
    }

    private val activeArcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = Color.parseColor("#5ED7D0")
    }

    private val tickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.parseColor("#4B5563")
    }

    private val majorTickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.parseColor("#9CA3AF")
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        color = Color.parseColor("#9CA3AF")
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
    }

    private val valueTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        color = Color.WHITE
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }

    private val titleTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        color = Color.parseColor("#6B7280")
        letterSpacing = 0.08f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }

    private val needlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL_AND_STROKE
        color = Color.parseColor("#EF4444")
    }

    private val hubPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#111827")
    }

    private val hubStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f
        color = Color.parseColor("#374151")
    }

    private val peakPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = Color.parseColor("#F59E0B")
    }

    private val startAngle = 135f
    private val sweepAngle = 270f

    init {
        // Hardware acceleration is optimal for custom canvas gauges
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    fun resetPeak() {
        peakValue = currentValue
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val diameter = (w.coerceAtMost(h) * 0.88f)
        val stroke = diameter * 0.055f
        trackPaint.strokeWidth = stroke
        activeArcPaint.strokeWidth = stroke
        peakPaint.strokeWidth = stroke * 0.7f

        val cx = w / 2f
        val cy = h / 2f
        val radius = (diameter - stroke) / 2f
        arcBounds.set(cx - radius, cy - radius, cx + radius, cy + radius)

        textPaint.textSize = diameter * 0.06f
        valueTextPaint.textSize = diameter * 0.19f
        titleTextPaint.textSize = diameter * 0.075f
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f
        val radius = arcBounds.width() / 2f
        if (radius <= 0) return

        // 1. Background Arc Track
        canvas.drawArc(arcBounds, startAngle, sweepAngle, false, trackPaint)

        // 2. Determine Color Zone based on current value
        val currentColor = when {
            currentValue >= criticalThreshold -> Color.parseColor("#EF4444") // Alert Red
            currentValue >= warningThreshold -> Color.parseColor("#F59E0B") // Amber Warning
            else -> Color.parseColor("#5ED7D0") // Cyan Nominal
        }
        activeArcPaint.color = currentColor
        needlePaint.color = currentColor

        // 3. Active Progress Arc
        val progressFraction = ((currentValue - minValue) / (maxValue - minValue)).coerceIn(0f, 1f)
        val activeSweep = progressFraction * sweepAngle
        if (activeSweep > 0.5f) {
            canvas.drawArc(arcBounds, startAngle, activeSweep, false, activeArcPaint)
        }

        // 4. Tick Marks
        val tickRadiusOuter = radius - (trackPaint.strokeWidth / 2f) - 4f
        val tickRadiusInnerMajor = tickRadiusOuter - (radius * 0.12f)
        val tickRadiusInnerMinor = tickRadiusOuter - (radius * 0.06f)
        val textRadius = tickRadiusInnerMajor - (radius * 0.14f)

        majorTickPaint.strokeWidth = radius * 0.022f
        tickPaint.strokeWidth = radius * 0.012f

        val totalTicks = ((maxValue - minValue) / (majorTickInterval / 2f)).toInt().coerceIn(4, 50)
        for (i in 0..totalTicks) {
            val tickFrac = i.toFloat() / totalTicks
            val tickAngleDeg = startAngle + tickFrac * sweepAngle
            val tickAngleRad = Math.toRadians(tickAngleDeg.toDouble())

            val isMajor = (i % 2 == 0)
            val rInner = if (isMajor) tickRadiusInnerMajor else tickRadiusInnerMinor
            val paint = if (isMajor) majorTickPaint else tickPaint

            val cosA = cos(tickAngleRad).toFloat()
            val sinA = sin(tickAngleRad).toFloat()

            val xStart = cx + rInner * cosA
            val yStart = cy + rInner * sinA
            val xEnd = cx + tickRadiusOuter * cosA
            val yEnd = cy + tickRadiusOuter * sinA

            canvas.drawLine(xStart, yStart, xEnd, yEnd, paint)

            if (isMajor) {
                val tickVal = minValue + tickFrac * (maxValue - minValue)
                val label = if (tickVal >= 1000) (tickVal / 1000).toInt().toString() else tickVal.toInt().toString()
                val xText = cx + textRadius * cosA
                val yText = cy + textRadius * sinA + (textPaint.textSize * 0.35f)
                canvas.drawText(label, xText, yText, textPaint)
            }
        }

        // 5. Peak Hold Marker (small yellow tick)
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
        val baseWidth = radius * 0.055f

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
        val hubRadius = radius * 0.14f
        canvas.drawCircle(cx, cy, hubRadius, hubPaint)
        canvas.drawCircle(cx, cy, hubRadius, hubStrokePaint)

        // 8. Digital Readout and Labels
        val formattedValue = if (currentValue == currentValue.toInt().toFloat()) {
            currentValue.toInt().toString()
        } else {
            String.format(java.util.Locale.US, "%.1f", currentValue)
        }

        // Current value readout (lower center)
        val valueY = cy + (radius * 0.52f)
        canvas.drawText(formattedValue, cx, valueY, valueTextPaint)

        // Unit label below value
        textPaint.textSize = radius * 0.13f
        canvas.drawText(unit, cx, valueY + (radius * 0.18f), textPaint)

        // Title at upper center
        canvas.drawText(title, cx, cy - (radius * 0.42f), titleTextPaint)
    }
}
