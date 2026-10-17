package com.example.obdapp

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View

/**
 * Modern, high-performance horizontal bar gauge for automotive metrics
 * (Coolant Temp, Fuel Level, Battery Voltage, Throttle %, Engine Load).
 * Features dynamic proportional sizing based on cell height for responsive layouts.
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
            updateLimitLabels()
            invalidate()
        }

    var maxValue: Float = 100f
        set(value) {
            if (!value.isFinite()) return
            val target = if (value > minValue) value else minValue + 1f
            if (field == target) return
            field = target
            updateLimitLabels()
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
            if (field == clamped && isAvailable) return
            field = clamped
            isAvailable = true
            updateFormattedValue()
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
            updateLimitLabels()
            updateFormattedValue()
            invalidate()
        }

    private var cachedFormattedValue = "0 %"
    private var cachedMinLabel = "0%"
    private var cachedMaxLabel = "100%"

    private fun updateFormattedValue() {
        cachedFormattedValue = if (!isAvailable) {
            "N/A"
        } else if (currentValue == currentValue.toInt().toFloat()) {
            "${currentValue.toInt()} $unit"
        } else {
            String.format(java.util.Locale.US, "%.1f %s", currentValue, unit)
        }
    }

    private fun updateLimitLabels() {
        cachedMinLabel = "${minValue.toInt()}$unit"
        cachedMaxLabel = "${maxValue.toInt()}$unit"
    }

    private var baseTitleTextSize = 14f
    private var baseValueTextSize = 18f
    private var barHeightPx = 18f

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
        val hFloat = h.toFloat()
        val wFloat = w.toFloat()

        // Bar Track Thickness: clamp(0.22 * H, 10px, 36px)
        barHeightPx = (hFloat * 0.22f).coerceIn(10f, 36f)

        // Title and Value Text Scaling
        baseTitleTextSize = (hFloat * 0.18f).coerceIn(11f, 22f)
        baseValueTextSize = (hFloat * 0.25f).coerceIn(13f, 28f)
        titlePaint.textSize = baseTitleTextSize
        valuePaint.textSize = baseValueTextSize
        limitPaint.textSize = (hFloat * 0.13f).coerceIn(9f, 15f)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0 || h <= 0) return

        titlePaint.textSize = baseTitleTextSize
        valuePaint.textSize = baseValueTextSize

        val paddingH = 10f
        val paddingV = 6f
        val rightMargin = 8f

        // Format Value + Unit from cache (zero allocation)
        val formattedValue = cachedFormattedValue

        valuePaint.color = if (isAvailable) Color.WHITE else COLOR_UNAVAILABLE

        // Adjust text sizes if title + value collide
        val availableW = w - paddingH - rightMargin
        val titleW = titlePaint.measureText(title)
        val valueW = valuePaint.measureText(formattedValue)
        if (titleW + valueW + 10f > availableW) {
            val scale = availableW / (titleW + valueW + 14f)
            titlePaint.textSize *= scale
            valuePaint.textSize *= scale
        }

        // 1. Title (Top Left)
        val titleY = paddingV + titlePaint.textSize
        canvas.drawText(title, paddingH, titleY, titlePaint)

        // 2. Value + Unit (Top Right)
        val valueY = paddingV + valuePaint.textSize
        canvas.drawText(formattedValue, w - rightMargin, valueY, valuePaint)

        // 3. Bar Track
        val barTop = titleY + (h * 0.10f)
        val barBottom = (barTop + barHeightPx).coerceAtMost(h - limitPaint.textSize - 6f)
        val barCorner = (barBottom - barTop) / 2f
        trackBounds.set(paddingH, barTop, w - paddingH, barBottom)
        canvas.drawRoundRect(trackBounds, barCorner, barCorner, trackPaint)

        // 4. Fill Bar with Dynamic Threshold Color (static color constants)
        if (isAvailable) {
            val fraction = ((currentValue - minValue) / (maxValue - minValue)).coerceIn(0f, 1f)
            val fillRight = paddingH + (fraction * (w - 2 * paddingH))

            val isLowCritical = criticalThreshold < warningThreshold
            val barColor = if (isLowCritical) {
                when {
                    currentValue <= criticalThreshold -> COLOR_CRITICAL
                    currentValue <= warningThreshold -> COLOR_WARNING
                    else -> COLOR_NORMAL
                }
            } else {
                when {
                    currentValue >= criticalThreshold -> COLOR_CRITICAL
                    currentValue >= warningThreshold -> COLOR_WARNING
                    else -> COLOR_NORMAL
                }
            }
            fillPaint.color = barColor

            if (fillRight > paddingH) {
                fillBounds.set(paddingH, barTop, fillRight, barBottom)
                canvas.drawRoundRect(fillBounds, barCorner, barCorner, fillPaint)
            }
        }

        // 5. Min / Max Labels from cache (Bottom Row if space permits)
        val footerY = barBottom + limitPaint.textSize + 4f
        if (footerY <= h) {
            limitPaint.textAlign = Paint.Align.LEFT
            canvas.drawText(cachedMinLabel, paddingH, footerY, limitPaint)

            limitPaint.textAlign = Paint.Align.RIGHT
            canvas.drawText(cachedMaxLabel, w - paddingH, footerY, limitPaint)
        }
    }

    companion object {
        private val COLOR_UNAVAILABLE = Color.parseColor("#6B7280")
        private val COLOR_CRITICAL = Color.parseColor("#EF4444")
        private val COLOR_WARNING = Color.parseColor("#F59E0B")
        private val COLOR_NORMAL = Color.parseColor("#5ED7D0")
    }
}
