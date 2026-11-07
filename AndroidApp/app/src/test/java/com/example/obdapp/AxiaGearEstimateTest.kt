package com.example.obdapp

import org.junit.Assert.*
import org.junit.Test

class AxiaGearEstimateTest {
    @Test fun requiresStableSamplesBeforeShowingEachGear() {
        val cases = listOf(Triple(1860, 15.0, 1), Triple(1750, 25.0, 2),
            Triple(1840, 40.0, 3), Triple(2400, 80.0, 4))
        for ((rpm, speed, gear) in cases) {
            val estimator = AxiaGearEstimate()
            assertNull(estimator.update(rpm, speed, 10, 0))
            assertNull(estimator.update(rpm, speed, 10, 500))
            assertEquals(gear, estimator.update(rpm, speed, 10, 1000))
        }
    }

    @Test fun clearsImmediatelyDuringShiftsAndWaitsForNewStableGear() {
        val e = AxiaGearEstimate()
        for (t in listOf(0L, 500L, 1000L)) e.update(2400, 80.0, 10, t)
        assertNull(e.update(3680, 80.0, 10, 1500))
        assertNull(e.update(3680, 80.0, 10, 2000))
        assertEquals(3, e.update(3680, 80.0, 10, 2500))
    }

    @Test fun rejectsStopCoastingIdleHeavyThrottleAndUnmatchedRatios() {
        for ((rpm, speed, throttle) in listOf(
            Triple(800, 0.0, 0), Triple(800, 50.0, 0), Triple(2400, 80.0, 80),
            Triple(2240, 40.0, 10), Triple(0, 0.0, 0), Triple(2400, Double.NaN, 10))) {
            val e = AxiaGearEstimate()
            repeat(5) { assertNull(e.update(rpm, speed, throttle, it * 500L)) }
        }
    }

    @Test fun lowSpeedCannotProduceAnApparentHigherGear() {
        val e = AxiaGearEstimate()
        repeat(5) { assertNull(e.update(1150, 25.0, 10, it * 500L)) }
        // A 4th-like ratio below the configured reliable speed is not trusted.
        repeat(5) { assertNull(e.update(1200, 40.0, 10, 3000L + it * 500L)) }
    }

    @Test fun staleClockReversalAndResetClearConfirmedGear() {
        val e = AxiaGearEstimate()
        for (t in listOf(0L, 500L, 1000L)) e.update(2400, 80.0, 10, t)
        assertEquals(4, e.current(2000))
        assertNull(e.current(2501))
        assertNull(e.update(2400, 80.0, 10, 3500))
        assertNull(e.update(2400, 80.0, 10, 3000))
        e.reset()
        assertNull(e.current(3500))
    }

    @Test fun substantialSlipWithinOneBandMustSettleAgain() {
        val e = AxiaGearEstimate()
        for (t in listOf(0L, 500L, 1000L)) e.update(1960, 40.0, 10, t)
        assertEquals(3, e.current(1000))
        assertNull(e.update(1720, 40.0, 10, 1500))
    }
}
