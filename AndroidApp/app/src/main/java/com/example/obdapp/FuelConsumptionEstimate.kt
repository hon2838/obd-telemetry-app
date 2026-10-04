package com.example.obdapp

/** A petrol estimate, not a measured injector fuel rate. No GPS fallback is used. */
internal object FuelConsumptionEstimate {
    const val MAX_READING_AGE_MS = 5_000L
    private const val PETROL_AIR_FUEL_RATIO = 14.7
    private const val PETROL_DENSITY_GRAMS_PER_LITRE = 750.0

    data class Result(val litresPerHour: Double, val kilometresPerLitre: Double)

    fun calculate(
        mafGps: Double?, speedKmh: Int?, fuelSystemStatus: Int?, readingAgeMs: Long, engineRpm: Int?
    ): Result? {
        if (readingAgeMs !in 0..MAX_READING_AGE_MS || mafGps == null ||
            !mafGps.isFinite() || mafGps <= 0.0 || mafGps > 655.35 ||
            speedKmh == null || speedKmh !in 0..255 || engineRpm == null || engineRpm !in 1..20000) return null
        // 02 means closed-loop oxygen-sensor feedback. Fixed stoichiometry is
        // unsuitable for warm-up/enrichment, fuel cut-off and sensor faults.
        if (fuelSystemStatus != 0x02) return null
        val litresPerHour = mafGps * 3600.0 /
            (PETROL_AIR_FUEL_RATIO * PETROL_DENSITY_GRAMS_PER_LITRE)
        val kilometresPerLitre = speedKmh / litresPerHour
        if (!litresPerHour.isFinite() || !kilometresPerLitre.isFinite() ||
            kilometresPerLitre > 1_000_000.0) return null
        // Zero distance at idle is a real 0 km/L; zero airflow is unavailable.
        return Result(litresPerHour, kilometresPerLitre)
    }
}
