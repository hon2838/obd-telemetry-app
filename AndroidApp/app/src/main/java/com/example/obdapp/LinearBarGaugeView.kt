package com.example.obdapp

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View

/**
 * Modern, high-performance horizontal bar gauge for automotive metrics
 * (Coolant Temp, Fuel Level, Battery Voltage, Throttle %, Engine Load).
 */
class LinearBarGaugeView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    var minValue: Float = 0f
        set(value) {
            if (!value.isFinite() || field == value) return
            field = value
            invalidate()
        }

    var maxValue: Float = 100f
        set(value) {
            if (!value.isFinite()) return
            val target = if (value > minValue) value else minValue + 1f
            if (field == target) return
            field = target
            invalidate()
        }

    var isAvailable: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            invalidate()
        }

    var currentValue: Float = 0f
        set(value) {
            if (!value.isFinite()) return
            val clamped = value.coerceIn(minValue, maxValue)
            if (field == clamped && isAvailable) return
            field = clamped
            isAvailable = true
            invalidate()
        }

    var warningThreshold: Float = 80f
        set(value) {
            if (!value.isFinite() || field == value) return
            field = value
            invalidate()
        }

    var criticalThreshold: Float = 90f
        set(value) {
            if (!value.isFinite() || field == value) return
            field = value
            invalidate()
        }

    var title: String = "METRIC"
        set(value) {
            field = value
            invalidate()
        }

    var unit: String = "%"
        set(value) {
            field = value
            invalidate()
        }

    private var baseTitleTextSize = 14f
    private var baseValueTextSize = 18f

    private val trackBounds = RectF()
    private val fillBounds = RectF()

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#1F2430")
    }

    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#5ED7D0")
    }

    private val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.LEFT
        color = Color.parseColor("#9CA3AF")
        letterSpacing = 0.05f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }

    private val valuePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.RIGHT
        color = Color.WHITE
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }

    private val limitPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#6B7280")
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val baseSize = minOf(h * 0.18f, w * 0.055f)
        baseTitleTextSize = baseSize.coerceIn(11f, 22f)
        baseValueTextSize = (baseSize * 1.25f).coerceIn(13f, 26f)
        titlePaint.textSize = baseTitleTextSize
        valuePaint.textSize = baseValueTextSize
        limitPaint.textSize = (baseSize * 0.75f).coerceIn(9f, 15f)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0 || h <= 0) return

        // Reset to base sizes before measuring to avoid progressive shrinking
        titlePaint.textSize = baseTitleTextSize
        valuePaint.textSize = baseValueTextSize

        val paddingH = 12f
        val paddingV = 8f
        val iconClearance = 32f

        // 2. Format Value + Unit
        val formattedValue = if (!isAvailable) {
            "N/A"
        } else if (currentValue == currentValue.toInt().toFloat()) {
            "${currentValue.toInt()} $unit"
        } else {
            String.format(java.util.Locale.US, "%.1f %s", currentValue, unit)
        }

        valuePaint.color = if (isAvailable) Color.WHITE else Color.parseColor("#6B7280")

        // Adjust text sizes if title + value collide
        val availableW = w - paddingH - iconClearance
        val titleW = titlePaint.measureText(title)
        val valueW = valuePaint.measureText(formattedValue)
        if (titleW + valueW + 12f > availableW) {
            val scale = availableW / (titleW + valueW + 16f)
            titlePaint.textSize *= scale
            valuePaint.textSize *= scale
        }

        // 1. Title (Top Left)
        val titleY = paddingV + titlePaint.textSize
        canvas.drawText(title, paddingH, titleY, titlePaint)

        // 2. Value + Unit (Top Right with clearance for cycle button)
        val valueY = paddingV + valuePaint.textSize
        canvas.drawText(formattedValue, w - iconClearance, valueY, valuePaint)

        // 3. Bar Track (with vertical clamping for compact slots)
        val barTop = titleY + (h * 0.12f)
        val maxBarBottom = (h - 4f) - limitPaint.textSize - 8f
        val rawBarBottom = barTop + (h * 0.28f).coerceAtLeast(14f)
        val barBottom = minOf(rawBarBottom, maxBarBottom).coerceAtLeast(barTop + 6f)
        val barCorner = (barBottom - barTop) / 2f
        trackBounds.set(paddingH, barTop, w - paddingH, barBottom)
        canvas.drawRoundRect(trackBounds, barCorner, barCorner, trackPaint)

        // 4. Fill Bar with Dynamic Threshold Color (supports inverted thresholds)
        if (isAvailable) {
            val fraction = ((currentValue - minValue) / (maxValue - minValue)).coerceIn(0f, 1f)
            val fillRight = paddingH + (fraction * (w - 2 * paddingH))

            val isLowCritical = criticalThreshold < warningThreshold
            val barColor = if (isLowCritical) {
                when {
                    currentValue <= criticalThreshold -> Color.parseColor("#EF4444")
                    currentValue <= warningThreshold -> Color.parseColor("#F59E0B")
                    else -> Color.parseColor("#5ED7D0")
                }
            } else {
                when {
                    currentValue >= criticalThreshold -> Color.parseColor("#EF4444")
                    currentValue >= warningThreshold -> Color.parseColor("#F59E0B")
                    else -> Color.parseColor("#5ED7D0")
                }
            }
            fillPaint.color = barColor

            if (fillRight > paddingH) {
                fillBounds.set(paddingH, barTop, fillRight, barBottom)
                canvas.drawRoundRect(fillBounds, barCorner, barCorner, fillPaint)
            }
        }

        // 5. Min / Max Labels (Bottom Row)
        val footerY = barBottom + limitPaint.textSize + 8f
        limitPaint.textAlign = Paint.Align.LEFT
        canvas.drawText("${minValue.toInt()}$unit", paddingH, footerY, limitPaint)

        limitPaint.textAlign = Paint.Align.RIGHT
        canvas.drawText("${maxValue.toInt()}$unit", w - paddingH, footerY, limitPaint)
    }
}
