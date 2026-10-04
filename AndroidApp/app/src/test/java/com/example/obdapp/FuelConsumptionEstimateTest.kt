package com.example.obdapp

import org.junit.Assert.*
import org.junit.Test

class FuelConsumptionEstimateTest {
    @Test fun estimatesFuelEconomyFromSameCycleAirflowAndObdSpeed() {
        // 30 g/s air / 14.7 AFR / 750 g/L * 3600 = 9.795918 L/h.
        val result = FuelConsumptionEstimate.calculate(30.0, 60, 2, 1000, engineRpm = 1000)!!
        assertEquals(9.795918367, result.litresPerHour, 0.000001)
        assertEquals(6.125, result.kilometresPerLitre, 0.000001)
    }

    @Test fun stationaryEngineConsumesFuelWithZeroKilometresPerLitre() {
        val result = FuelConsumptionEstimate.calculate(3.24, 0, 2, 1000, engineRpm = 1000)!!
        assertEquals(1.057959184, result.litresPerHour, 0.000001)
        assertEquals(0.0, result.kilometresPerLitre, 0.0)
    }

    @Test fun suppressesWarmupEnrichmentFuelCutAndFaultStates() {
        for (status in listOf(null, 0, 1, 4, 8, 16, 3, 255)) {
            assertNull(FuelConsumptionEstimate.calculate(30.0, 60, status, 1000, engineRpm = 1000))
        }
    }

    @Test fun missingInvalidOrZeroAirflowNeverInventsAnEconomy() {
        for (maf in listOf(null, 0.0, -1.0, 655.36, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertNull(FuelConsumptionEstimate.calculate(maf, 60, 2, 1000, engineRpm = 1000))
        }
        for (speed in listOf(null, -1, 256)) {
            assertNull(FuelConsumptionEstimate.calculate(30.0, speed, 2, 1000, engineRpm = 1000))
        }
    }

    @Test fun stoppedOrUnknownEngineDoesNotInventFuelUse() {
        assertNull(FuelConsumptionEstimate.calculate(3.24, 0, 2, 1000, engineRpm = 0))
        assertNull(FuelConsumptionEstimate.calculate(3.24, 0, 2, 1000, engineRpm = null))
    }

    @Test fun staleAndFutureInputsCannotShowAValidLiveEstimate() {
        assertNull(FuelConsumptionEstimate.calculate(30.0, 60, 2, 5001, engineRpm = 1000))
        assertNull(FuelConsumptionEstimate.calculate(30.0, 60, 2, -1, engineRpm = 1000))
        assertNotNull(FuelConsumptionEstimate.calculate(30.0, 60, 2, 5000, engineRpm = 1000))
    }
}
