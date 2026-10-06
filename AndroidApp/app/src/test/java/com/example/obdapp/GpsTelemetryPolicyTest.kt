package com.example.obdapp

import org.junit.Assert.*
import org.junit.Test

class GpsTelemetryPolicyTest {
    private val policy = GpsTelemetryPolicy()

    @Test
    fun rejectsOldCachedFixAndLeavesPolicyEmpty() {
        assertFalse(policy.accept(fix(timeMs = 1_000L), nowMs = 35_000L))
        assertNull(policy.current(nowMs = 35_000L))
    }

    @Test
    fun rejectsFutureAndOutOfOrderFixes() {
        assertFalse(policy.accept(fix(timeMs = 2_001L), nowMs = 2_000L))
        assertTrue(policy.accept(fix(timeMs = 2_000L), nowMs = 2_000L))
        assertFalse(policy.accept(fix(timeMs = 1_999L), nowMs = 2_000L))
        assertEquals(2_000L * NANOS_PER_MS, policy.current(nowMs = 2_000L)!!.elapsedRealtimeNanos)
    }

    @Test
    fun rejectsInvalidCoordinatesAndNonFiniteMeasurements() {
        assertFalse(policy.accept(fix(latitude = 91.0), nowMs = 1_000L))
        assertFalse(policy.accept(fix(longitude = Double.NaN), nowMs = 1_000L))
        assertFalse(policy.accept(fix(altitudeMeters = Double.POSITIVE_INFINITY), nowMs = 1_000L))
        assertFalse(policy.accept(fix(speedMps = Float.NaN), nowMs = 1_000L))
        assertFalse(policy.accept(fix(speedMps = -1.0f), nowMs = 1_000L))
        assertNull(policy.current(nowMs = 1_000L))
    }

    @Test
    fun expiresSpeedBeforeCoordinatesThenExpiresCoordinates() {
        assertTrue(policy.accept(fix(timeMs = 5_000L), nowMs = 5_000L))
        val afterSpeedExpiry = policy.current(nowMs = 8_001L)!!
        assertNull(afterSpeedExpiry.speedKmh)
        assertEquals(42.0, afterSpeedExpiry.latitude, 0.0)
        assertEquals(12.6f, policy.current(nowMs = 8_000L)!!.speedKmh!!, 0.001f)
        assertEquals(42.0, policy.current(nowMs = 15_001L)!!.latitude, 0.0)
        assertNull(policy.current(nowMs = 35_001L))
    }

    @Test
    fun preservesAbsentOptionalMeasurements() {
        assertTrue(policy.accept(fix(timeMs = 7_000L, altitudeMeters = null, speedMps = null), nowMs = 7_000L))
        val current = policy.current(nowMs = 7_001L)!!
        assertNull(current.altitudeMeters)
        assertNull(current.speedKmh)
    }

    @Test
    fun clearingDisabledProviderDropsFixAndDuplicateDoesNotRefreshAge() {
        assertTrue(policy.accept(fix(timeMs = 1_000L), nowMs = 1_000L))
        assertFalse(policy.accept(fix(timeMs = 1_000L), nowMs = 10_000L))
        assertNull(policy.current(nowMs = 31_001L))
        policy.clear()
        assertNull(policy.current(nowMs = 1_000L))
    }

    private fun fix(
        latitude: Double = 42.0,
        longitude: Double = -71.0,
        altitudeMeters: Double? = 10.0,
        speedMps: Float? = 3.5f,
        timeMs: Long = 1_000L
    ) = GpsTelemetryPolicy.Fix(
        latitude = latitude,
        longitude = longitude,
        altitudeMeters = altitudeMeters,
        speedMetersPerSecond = speedMps,
        elapsedRealtimeNanos = timeMs * NANOS_PER_MS
    )

    private fun GpsTelemetryPolicy.accept(fix: GpsTelemetryPolicy.Fix, nowMs: Long) =
        accept(fix, nowMs * NANOS_PER_MS)

    private fun GpsTelemetryPolicy.current(nowMs: Long) = current(nowMs * NANOS_PER_MS)

    companion object {
        private const val NANOS_PER_MS = 1_000_000L
    }
}
