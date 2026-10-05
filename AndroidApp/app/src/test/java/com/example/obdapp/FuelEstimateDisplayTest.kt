package com.example.obdapp

import java.util.Locale
import org.junit.Assert.*
import org.junit.Test

class FuelEstimateDisplayTest {
    private val now = 1700000000000L
    private fun display(economy: Double? = 12.5, rate: Double? = 1.06,
                        age: Long = 0, connected: Boolean = true) =
        FuelEstimateDisplay.format(economy, rate, now - age, now, connected, Locale.US)

    @Test fun preservesIdleZeroAndShowsSuppliedRate() {
        assertEquals("0.0 km/L\nEstimated fuel rate: 1.1 L/h", display(economy = 0.0))
        assertEquals("12.5 km/L\nEstimated fuel rate: 0.0 L/h", display(rate = 0.0))
    }

    @Test fun refusesOldFutureAndDisconnectedValues() {
        assertTrue(display(age = 5000).contains("12.5 km/L"))
        assertEquals("N/A · Reading too old", display(age = 5001))
        assertEquals("N/A · Awaiting fresh reading", display(age = -1))
        assertEquals("N/A · Disconnected", display(connected = false))
        assertEquals("N/A · Awaiting fresh reading",
            FuelEstimateDisplay.format(12.5, 1.06, 0, now, true))
    }

    @Test fun missingOrInvalidFieldDoesNotHideTheOtherOrInventAReason() {
        for (value in listOf(null, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertEquals("N/A\nEstimated fuel rate: 1.1 L/h\nEstimate unavailable or incomplete",
                display(economy = value))
            assertEquals("12.5 km/L\nEstimated fuel rate: N/A\nEstimate unavailable or incomplete",
                display(rate = value))
        }
        assertEquals("N/A\nEstimated fuel rate: N/A\nEstimate unavailable or incomplete",
            display(economy = null, rate = null))
    }

    @Test fun honoursDisplayLocale() {
        assertEquals("12,5 km/L\nEstimated fuel rate: 1,1 L/h",
            FuelEstimateDisplay.format(12.5, 1.06, now, now, true, Locale.GERMANY))
    }
}
