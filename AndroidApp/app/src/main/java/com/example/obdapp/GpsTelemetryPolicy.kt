package com.example.obdapp

/**
 * Accepts GPS fixes only when their monotonic timestamp is current and newer than
 * the last accepted fix. This class has no Android dependencies so it can be
 * exercised on the JVM.
 */
internal class GpsTelemetryPolicy(
    private val coordinateMaxAgeMs: Long = DEFAULT_COORDINATE_MAX_AGE_MS,
    private val speedMaxAgeMs: Long = DEFAULT_SPEED_MAX_AGE_MS
) {
    data class Fix(
        val latitude: Double,
        val longitude: Double,
        val altitudeMeters: Double?,
        val speedMetersPerSecond: Float?,
        val elapsedRealtimeNanos: Long
    )

    /** A usable view at [nowElapsedRealtimeNanos]; speed can expire before coordinates. */
    data class FreshFix(
        val latitude: Double,
        val longitude: Double,
        val altitudeMeters: Double?,
        val speedKmh: Float?,
        val elapsedRealtimeNanos: Long
    )

    private var latest: Fix? = null

    init {
        require(coordinateMaxAgeMs >= 0L)
        require(speedMaxAgeMs >= 0L)
    }

    /**
     * Store a fix only if it is well-formed, not from the future, and not older
     * than the coordinate freshness window at receipt time.
     */
    @Synchronized
    fun accept(fix: Fix, nowElapsedRealtimeNanos: Long): Boolean {
        if (!isValid(fix) || nowElapsedRealtimeNanos < 0L) return false
        if (fix.elapsedRealtimeNanos > nowElapsedRealtimeNanos) return false
        val ageNanos = nowElapsedRealtimeNanos - fix.elapsedRealtimeNanos
        if (ageNanos > coordinateMaxAgeMs * NANOS_PER_MILLISECOND) return false
        val previous = latest
        if (previous != null && fix.elapsedRealtimeNanos <= previous.elapsedRealtimeNanos) return false
        latest = fix
        return true
    }

    /** Return current coordinates, with speed independently aged out when necessary. */
    @Synchronized
    fun current(nowElapsedRealtimeNanos: Long): FreshFix? {
        val fix = latest ?: return null
        if (nowElapsedRealtimeNanos < fix.elapsedRealtimeNanos) return null
        val ageNanos = nowElapsedRealtimeNanos - fix.elapsedRealtimeNanos
        if (ageNanos > coordinateMaxAgeMs * NANOS_PER_MILLISECOND) return null
        val speedKmh = if (
            fix.speedMetersPerSecond != null &&
            ageNanos <= speedMaxAgeMs * NANOS_PER_MILLISECOND
        ) fix.speedMetersPerSecond * METERS_PER_SECOND_TO_KMH else null
        return FreshFix(
            latitude = fix.latitude,
            longitude = fix.longitude,
            altitudeMeters = fix.altitudeMeters,
            speedKmh = speedKmh,
            elapsedRealtimeNanos = fix.elapsedRealtimeNanos
        )
    }

    @Synchronized
    fun clear() {
        latest = null
    }

    private fun isValid(fix: Fix): Boolean =
        fix.latitude.isFinite() && fix.latitude in -90.0..90.0 &&
            fix.longitude.isFinite() && fix.longitude in -180.0..180.0 &&
            (fix.altitudeMeters == null || fix.altitudeMeters.isFinite()) &&
            (fix.speedMetersPerSecond == null ||
                (fix.speedMetersPerSecond.isFinite() && fix.speedMetersPerSecond >= 0.0f)) &&
            fix.elapsedRealtimeNanos >= 0L

    companion object {
        const val DEFAULT_COORDINATE_MAX_AGE_MS = 30_000L
        const val DEFAULT_SPEED_MAX_AGE_MS = 3_000L
        private const val NANOS_PER_MILLISECOND = 1_000_000L
        private const val METERS_PER_SECOND_TO_KMH = 3.6f
    }
}
