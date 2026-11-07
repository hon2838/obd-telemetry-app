package com.example.obdapp

import org.junit.Assert.*
import org.junit.Test

class SpeedComparisonReadingTest {
    @Test fun freshReadingsShowVehicleMinusGpsAndPreserveZero() {
        val reading = SpeedComparisonReading("car", 80f, 10_000, 78f, 9_500)
        assertEquals(SpeedComparisonReading.Values(80f, 78f, 2f), reading.current("car", 10_500))
        assertEquals(SpeedComparisonReading.Values(0f, 0f, 0f),
            SpeedComparisonReading("car", 0f, 10_000, 0f, 10_000).current("car", 10_000))
    }

    @Test fun eachSourceExpiresFromItsOwnCaptureTime() {
        val reading = SpeedComparisonReading("car", 80f, 10_000, 78f, 10_000)
        assertEquals(SpeedComparisonReading.Values(null, 78f, null), reading.current("car", 11_501))
        assertEquals(SpeedComparisonReading.Values(), reading.current("car", 13_001))
        assertEquals(SpeedComparisonReading.Values(80f, null, null),
            reading.copy(obdAtElapsedMs = 14_000).current("car", 14_000))
    }

    @Test fun aRepeatedGpsFixCannotBecomeANewSynchronizedPair() {
        val reading = SpeedComparisonReading("car", 80f, 12_000, 78f, 10_000)
        assertEquals(SpeedComparisonReading.Values(80f, 78f, null), reading.current("car", 12_000))
        assertEquals(SpeedComparisonReading.Values(80f, null, null),
            reading.copy(obdAtElapsedMs = 13_001).current("car", 13_001))
    }

    @Test fun futureTimestampsAndOtherVehiclesCannotProduceAComparison() {
        val reading = SpeedComparisonReading("car", 80f, 10_000, 78f, 10_000)
        assertEquals(SpeedComparisonReading.Values(), reading.current("other", 10_000))
        assertEquals(SpeedComparisonReading.Values(), reading.current("car", 9_999))
        assertEquals(SpeedComparisonReading.Values(), reading.current("car", -1))
    }

    @Test fun missingInvalidAndImplausibleValuesAreNeverTurnedIntoZero() {
        for (value in listOf(null, -1f, Float.NaN, Float.POSITIVE_INFINITY, 1000f)) {
            val reading = SpeedComparisonReading("car", value, 10_000, value, 10_000)
            assertEquals(SpeedComparisonReading.Values(), reading.current("car", 10_000))
        }
        assertEquals(SpeedComparisonReading.Values(null, 78f, null),
            SpeedComparisonReading("car", 80f, -1, 78f, 10_000).current("car", 10_000))
    }
}
