package com.example.obdapp

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

class FuelHistoryDisplayTest {

    @Test
    fun averageHandlesFleetMissingAndInvalidCycles() {
        assertEquals("N/A", FuelHistoryDisplay.average(14.5, 3, fleet = true, locale = Locale.US))
        assertEquals("N/A", FuelHistoryDisplay.average(null, 3, fleet = false, locale = Locale.US))
        assertEquals("N/A", FuelHistoryDisplay.average(Double.NaN, 3, fleet = false, locale = Locale.US))
        assertEquals("N/A", FuelHistoryDisplay.average(Double.POSITIVE_INFINITY, 3, fleet = false, locale = Locale.US))
        assertEquals("N/A", FuelHistoryDisplay.average(0.0, 3, fleet = false, locale = Locale.US))
        assertEquals("N/A", FuelHistoryDisplay.average(14.5, null, fleet = false, locale = Locale.US))
        assertEquals("N/A", FuelHistoryDisplay.average(14.5, 0, fleet = false, locale = Locale.US))
    }

    @Test
    fun averageFormatsValidSingleVehicleCycleEconomy() {
        assertEquals("14.52", FuelHistoryDisplay.average(14.524, 2, fleet = false, locale = Locale.US))
        assertEquals("14,52", FuelHistoryDisplay.average(14.524, 2, fleet = false, locale = Locale.GERMANY))
    }

    @Test
    fun summaryReportsFleetUnavailableOrRange() {
        assertEquals(
            "Select one vehicle for fuel economy",
            FuelHistoryDisplay.summary(cycleCount = 3, worst = 12.0, best = 15.0, fleet = true, locale = Locale.US)
        )
        assertEquals(
            "Full-tank cycle data unavailable",
            FuelHistoryDisplay.summary(cycleCount = null, worst = 12.0, best = 15.0, fleet = false, locale = Locale.US)
        )
        assertEquals(
            "Need two confirmed full fills",
            FuelHistoryDisplay.summary(cycleCount = 0, worst = null, best = null, fleet = false, locale = Locale.US)
        )
        assertEquals(
            "3 full-tank cycles · 12.10 – 15.40 km/L",
            FuelHistoryDisplay.summary(cycleCount = 3, worst = 12.1, best = 15.4, fleet = false, locale = Locale.US)
        )
        assertEquals(
            "3 full-tank cycles",
            FuelHistoryDisplay.summary(cycleCount = 3, worst = null, best = null, fleet = false, locale = Locale.US)
        )
    }

    @Test
    fun economyFormatsFullCycleAndExplicitNonCycleStatuses() {
        assertEquals(
            "14.50 km/L over 500 km / 34.5 L",
            FuelHistoryDisplay.economy(
                status = "full-cycle", value = 14.5, distance = 500.0, litres = 34.5, locale = Locale.US
            )
        )
        assertEquals(
            "14.50 km/L",
            FuelHistoryDisplay.economy(
                status = "full-cycle", value = 14.5, distance = null, litres = null, locale = Locale.US
            )
        )
        assertEquals("Full-tank baseline", FuelHistoryDisplay.economy("full-baseline", null, null, null))
        assertEquals("Partial fill · awaiting full fill", FuelHistoryDisplay.economy("partial-fill", null, null, null))
        assertEquals("Unclassified fill · economy unavailable", FuelHistoryDisplay.economy("unknown-fill", null, null, null))
        assertEquals("Invalid interval · economy unavailable", FuelHistoryDisplay.economy("invalid-interval", null, null, null))
        assertEquals("Full-tank economy unavailable", FuelHistoryDisplay.economy(null, null, null, null))
    }
}
