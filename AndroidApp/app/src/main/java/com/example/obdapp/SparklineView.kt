package com.example.obdapp

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View

/**
 * Lightweight real-time waveform sparkline for RPM, speed, or other telemetry history.
 * Dynamically scales line thickness based on view bounds.
 */
class SparklineView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private var rpmHistory: MutableList<Float?> = mutableListOf()
    private var speedHistory: MutableList<Float?> = mutableListOf()
    private val maxPoints = 20
    private val sparkPath = Path()

    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#2C2C2E")
        strokeWidth = 1f
        style = Paint.Style.STROKE
    }
    private val rpmPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#34C759")
        strokeWidth = 3f
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
    }
    private val speedPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#5ED7D0")
        strokeWidth = 3f
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val stroke = (h.toFloat() * 0.025f).coerceIn(2f, 6f)
        rpmPaint.strokeWidth = stroke
        speedPaint.strokeWidth = stroke
    }

    fun push(rpm: Int?, speedKmh: Float?) {
        rpmHistory.add(rpm?.toFloat())
        speedHistory.add(speedKmh)
        if (rpmHistory.size > maxPoints) rpmHistory.removeAt(0)
        if (speedHistory.size > maxPoints) speedHistory.removeAt(0)
        invalidate()
    }

    fun clear() {
        rpmHistory.clear()
        speedHistory.clear()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        val pad = 6f
        val top = pad
        val bottom = h - pad
        val left = pad
        val right = w - pad
        val contentH = bottom - top

        canvas.drawLine(left, top + contentH * 0.5f, right, top + contentH * 0.5f, gridPaint)
        canvas.drawLine(left, top + contentH * 0.25f, right, top + contentH * 0.25f, gridPaint.apply { alpha = 80 })
        canvas.drawLine(left, top + contentH * 0.75f, right, top + contentH * 0.75f, gridPaint.apply { alpha = 80 })
        gridPaint.alpha = 255

        if (rpmHistory.size < 2 && speedHistory.size < 2) return

        val rpmMax = 7000f
        val speedMax = 160f

        drawSeries(canvas, rpmHistory, rpmMax, left, right, top, contentH, rpmPaint)
        drawSeries(canvas, speedHistory, speedMax, left, right, top, contentH, speedPaint)
    }

    private fun drawSeries(
        canvas: Canvas,
        values: List<Float?>,
        maxVal: Float,
        left: Float,
        right: Float,
        top: Float,
        contentH: Float,
        paint: Paint
    ) {
        if (values.size < 2) return
        val stepX = (right - left) / (maxPoints - 1).coerceAtLeast(1)
        sparkPath.reset()
        var hasValidPoint = false

        for (i in values.indices) {
            val v = values[i]
            if (v == null) {
                if (hasValidPoint) {
                    canvas.drawPath(sparkPath, paint)
                    sparkPath.reset()
                    hasValidPoint = false
                }
                continue
            }
            val norm = (v / maxVal).coerceIn(0f, 1f)
            val x = left + i * stepX + (maxPoints - values.size) * stepX
            val y = top + contentH * (1f - norm)
            if (!hasValidPoint) {
                sparkPath.moveTo(x, y)
                hasValidPoint = true
            } else {
                sparkPath.lineTo(x, y)
            }
        }
        if (hasValidPoint) {
            canvas.drawPath(sparkPath, paint)
        }
    }
}
