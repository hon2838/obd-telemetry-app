package com.example.obdapp

import java.util.Locale

/** Formats the supplied same-sample estimates; it never calculates a missing value. */
internal object FuelEstimateDisplay {
    fun format(
        economyKmL: Double?, rateLph: Double?, timestamp: Long, now: Long,
        connectionOk: Boolean, locale: Locale = Locale.getDefault()
    ): String {
        if (!connectionOk) return "N/A · Disconnected"
        if (timestamp <= 0 || now < timestamp) return "N/A · Awaiting fresh reading"
        if (now - timestamp > FuelConsumptionEstimate.MAX_READING_AGE_MS) {
            return "N/A · Reading too old"
        }
        fun reading(value: Double?, unit: String): String? = value
            ?.takeIf { it.isFinite() && it >= 0.0 }
            ?.let { String.format(locale, "%.1f %s", it, unit) }
        val economy = reading(economyKmL, "km/L")
        val rate = reading(rateLph, "L/h")
        val values = "${economy ?: "N/A"}\nEstimated fuel rate: ${rate ?: "N/A"}"
        // Null does not tell us whether a PID is unsupported, the ECU is
        // open-loop, or a sample failed. Keep the explanation conservative.
        return if (economy == null || rate == null) {
            "$values\nEstimate unavailable or incomplete"
        } else values
    }
}
