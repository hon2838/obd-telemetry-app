package com.example.obdapp

import java.util.Locale

/** Displays server-confirmed full-tank cycles, never adjacent-fill arithmetic. */
internal object FuelHistoryDisplay {
    fun average(value: Double?, cycleCount: Int?, fleet: Boolean, locale: Locale = Locale.getDefault()): String =
        if (!fleet && cycleCount != null && cycleCount > 0 && value != null && value.isFinite() && value > 0)
            String.format(locale, "%.2f", value) else "N/A"

    fun summary(cycleCount: Int?, worst: Double?, best: Double?, fleet: Boolean,
                locale: Locale = Locale.getDefault()): String {
        if (fleet) return "Select one vehicle for fuel economy"
        if (cycleCount == null) return "Full-tank cycle data unavailable"
        if (cycleCount <= 0) return "Need two confirmed full fills"
        val range = if (worst != null && best != null && worst.isFinite() && best.isFinite() && worst > 0 && best > 0)
            String.format(locale, " · %.2f – %.2f km/L", worst, best) else ""
        return "$cycleCount full-tank cycles$range"
    }

    fun economy(status: String?, value: Double?, distance: Double?, litres: Double?,
                locale: Locale = Locale.getDefault()): String {
        if (status == "full-cycle" && value != null && value.isFinite() && value > 0) {
            val interval = if (distance != null && litres != null && distance.isFinite() && litres.isFinite() && distance > 0 && litres > 0)
                String.format(locale, " over %,.0f km / %.1f L", distance, litres) else ""
            return String.format(locale, "%.2f km/L", value) + interval
        }
        return when (status) {
            "full-baseline" -> "Full-tank baseline"
            "partial-fill" -> "Partial fill · awaiting full fill"
            "unknown-fill" -> "Unclassified fill · economy unavailable"
            "invalid-interval" -> "Invalid interval · economy unavailable"
            else -> "Full-tank economy unavailable"
        }
    }
}
