package com.example.obdapp

import kotlin.math.abs

/** Initial observed RPM/km/h bands for this Axia 4AT, not factory or ECU-reported ratios. */
internal class AxiaGearEstimate {
    private val bands = doubleArrayOf(124.0, 70.0, 46.0, 30.0)
    private val minSpeeds = doubleArrayOf(12.0, 18.0, 30.0, 50.0)
    private var candidate: Int? = null
    private var since = 0L
    private var samples = 0
    private var lastAt: Long? = null
    private var lastRatio: Double? = null
    private var confirmed: Int? = null

    fun reset() {
        candidate = null
        confirmed = null
        samples = 0
        lastAt = null
        lastRatio = null
    }

    fun current(nowElapsedMs: Long): Int? {
        val last = lastAt ?: return null
        return confirmed.takeIf { nowElapsedMs >= last && nowElapsedMs - last <= 1_500L }
    }

    fun update(rpm: Int?, speedKmh: Double?, throttle: Int?, nowElapsedMs: Long): Int? {
        val previousAt = lastAt
        if (nowElapsedMs < 0 || rpm == null || rpm !in 1000..5000 || speedKmh == null ||
            !speedKmh.isFinite() || speedKmh !in 12.0..160.0 || throttle == null || throttle !in 0..40 ||
            (previousAt != null && nowElapsedMs <= previousAt)) {
            reset()
            return null
        }
        if (previousAt != null && nowElapsedMs - previousAt > 1_500L) reset()
        val ratio = rpm / speedKmh
        val index = bands.indices.minByOrNull { abs(ratio / bands[it] - 1.0) }!!
        val match = (index + 1).takeIf {
            speedKmh >= minSpeeds[index] && abs(ratio / bands[index] - 1.0) <= 0.075
        }
        val unstable = lastRatio?.let { abs(ratio / it - 1.0) > 0.08 } ?: false
        lastAt = nowElapsedMs
        lastRatio = ratio
        if (match == null || match != candidate || unstable) {
            candidate = match
            since = nowElapsedMs
            samples = if (match == null) 0 else 1
            confirmed = null
        } else {
            samples++
            if (samples >= 3 && nowElapsedMs - since >= 1_000L) confirmed = match
        }
        return current(nowElapsedMs)
    }
}
