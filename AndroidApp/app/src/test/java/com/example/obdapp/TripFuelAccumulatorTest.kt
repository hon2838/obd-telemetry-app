package com.example.obdapp

import org.junit.Assert.*
import org.junit.Test

class TripFuelAccumulatorTest {
    private val wall = 1_700_000_000_000L
    private fun TripFuelAccumulator.point(t: Long, speed: Double? = 60.0, rate: Double? = 6.0,
                                         session: Long? = 1, boot: Int = 4) =
        observe(wall + t, t, boot, speed, rate, session)!!

    @Test fun integratesLitresAndDistanceIncludingIdleInsteadOfAveragingInstantRatios() {
        val a = TripFuelAccumulator("car")
        assertNull(a.point(0).economyKmL)
        assertEquals(10.0, a.point(10_000).economyKmL!!, 0.000001)
        a.point(20_000, 0.0, 1.0)
        val beforeIdle = a.state!!
        val result = a.point(30_000, 0.0, 1.0)
        assertEquals(0.25, a.state!!.distanceKm, 0.000001)
        assertEquals(beforeIdle.distanceKm, a.state!!.distanceKm, 0.0)
        assertTrue(a.state!!.fuelLitres > beforeIdle.fuelLitres)
        assertEquals(60.0 / 7, result.economyKmL!!, 0.000001)
        assertEquals(1.0, result.coverageRatio, 0.0)
    }

    @Test fun missingFuelNeverContributesDistanceWithoutMatchingFuel() {
        val a = TripFuelAccumulator("car")
        a.point(0); a.point(1000); a.point(2000, rate = null)
        a.point(3000); val result = a.point(4000)
        assertEquals(2000L, a.state!!.coveredMs)
        assertEquals(4000L, a.state!!.durationMs)
        assertEquals(1.0 / 30, a.state!!.distanceKm, 0.000001)
        assertEquals(10.0, result.economyKmL!!, 0.000001)
        assertEquals(0.5, result.coverageRatio, 0.0)
    }

    @Test fun longIntervalsAndChangedAdapterSessionsAreNotInterpolated() {
        val a = TripFuelAccumulator("car")
        a.point(0); a.point(30_000)
        assertEquals(30_000L, a.state!!.coveredMs)
        a.point(60_001)
        assertEquals(30_000L, a.state!!.coveredMs)
        a.point(61_001, session = 2)
        assertEquals(30_000L, a.state!!.coveredMs)
        a.point(62_001, session = 2)
        assertEquals(31_000L, a.state!!.coveredMs)
    }

    @Test fun disconnectedPollingRemainsUncoveredRatherThanPretendingCompleteQuality() {
        val a = TripFuelAccumulator("car")
        a.point(0); a.point(1000)
        repeat(270) { a.point(2000L + it * 1000, speed = null, rate = null, session = null) }
        assertEquals(271_000L, a.state!!.durationMs)
        assertEquals(1000L, a.state!!.coveredMs)
        assertEquals(1.0 / 271, a.state!!.reading().coverageRatio, 0.000001)
        assertEquals(10.0, a.state!!.reading().economyKmL!!, 0.000001)
    }

    @Test fun fiveMinuteBoundaryIsStrictAndNewTripStartsWithNoInventedInterval() {
        val a = TripFuelAccumulator("car")
        a.point(0); a.point(1000)
        a.point(301_000)
        assertEquals(wall, a.state!!.startedAtWallMs)
        a.point(601_001)
        assertEquals(wall + 601_001, a.state!!.startedAtWallMs)
        assertEquals(0L, a.state!!.durationMs)
        assertNull(a.state!!.reading().economyKmL)
        assertEquals(10.0, a.point(602_001).economyKmL!!, 0.000001)
    }

    @Test fun restoredTotalsSurviveButDowntimeIsNeverInterpolated() {
        val old = TripFuelAccumulator("car")
        old.point(0); old.point(1000)
        val resumed = TripFuelAccumulator("car", old.state)
        val gapResult = resumed.point(21_000)
        assertEquals(1000L, resumed.state!!.coveredMs)
        assertEquals(21_000L, resumed.state!!.durationMs)
        assertEquals(10.0, gapResult.economyKmL!!, 0.000001)
        resumed.point(22_000)
        assertEquals(2000L, resumed.state!!.coveredMs)
    }

    @Test fun invalidInputsDisconnectAndOrderingBreakPairingWithoutDoubleCounting() {
        val a = TripFuelAccumulator("car")
        a.point(0); a.point(1000)
        a.point(1000); a.point(900)
        a.point(2000)
        assertEquals(1000L, a.state!!.coveredMs)
        a.point(3000, speed = Double.NaN)
        a.point(4000); a.point(5000, rate = -1.0)
        a.point(6000); a.point(7000, session = null)
        a.point(8000)
        assertEquals(1000L, a.state!!.coveredMs)
        a.point(9000)
        assertEquals(2000L, a.state!!.coveredMs)
    }

    @Test fun rebootStartsNewTripAndWallClockCorrectionsDoNotIntegrateTime() {
        val a = TripFuelAccumulator("car")
        a.point(0); a.point(1000)
        a.observe(wall - 50_000, 2000, 4, 60.0, 6.0, 1)
        assertEquals(2000L, a.state!!.durationMs)
        a.point(100, boot = 5)
        assertEquals(0L, a.state!!.coveredMs)
        assertNull(a.state!!.reading().economyKmL)
    }

    @Test fun idleProducesZeroEconomyButZeroFuelProducesNoInfinity() {
        val a = TripFuelAccumulator("idle")
        a.point(0, 0.0, 1.0)
        assertEquals(0.0, a.point(1000, 0.0, 1.0).economyKmL!!, 0.0)
        val b = TripFuelAccumulator("zero")
        b.point(0, rate = 0.0)
        assertNull(b.point(1000, rate = 0.0).economyKmL)
    }

    @Test fun UIProjectionRejectsWrongVehicleStaleClockAndMalformedNumbers() {
        val r = TripFuelReading("a", 12.4, 0.8, 1000)
        assertNotNull(r.current("a", 301_000))
        assertNull(r.current("a", 301_001))
        assertNull(r.current("b", 2000))
        assertNull(r.current("a", 999))
        assertNull(r.copy(coverageRatio = Double.NaN).current("a", 2000))
        assertNull(r.copy(economyKmL = Double.POSITIVE_INFINITY).current("a", 2000))
    }
}
