package com.example.obdapp

import kotlin.math.abs

/** Separate sensor timestamps prevent a repeated GPS fix from becoming a new speed sample. */
internal data class SpeedComparisonReading(
    val vehicleId: String,
    val obdKmh: Float?,
    val obdAtElapsedMs: Long,
    val gpsKmh: Float?,
    val gpsAtElapsedMs: Long
) {
    data class Values(val obdKmh: Float? = null, val gpsKmh: Float? = null, val differenceKmh: Float? = null)

    fun current(vehicle: String, nowElapsedMs: Long): Values {
        if (vehicle != vehicleId || nowElapsedMs < 0) return Values()
        fun fresh(value: Float?, at: Long, maxAge: Long): Float? = value?.takeIf {
            it.isFinite() && it >= 0f && at >= 0L && at <= nowElapsedMs && nowElapsedMs - at <= maxAge
        }
        val obd = fresh(obdKmh?.takeIf { it <= 255f }, obdAtElapsedMs, OBD_MAX_AGE_MS)
        val gps = fresh(gpsKmh?.takeIf { it <= 400f }, gpsAtElapsedMs, GpsTelemetryPolicy.DEFAULT_SPEED_MAX_AGE_MS)
        val difference = if (obd != null && gps != null &&
            abs(obdAtElapsedMs - gpsAtElapsedMs) <= MAX_PAIR_SKEW_MS) obd - gps else null
        return Values(obd, gps, difference)
    }

    companion object {
        const val OBD_MAX_AGE_MS = 1_500L
        const val MAX_PAIR_SKEW_MS = 1_500L
    }
}
