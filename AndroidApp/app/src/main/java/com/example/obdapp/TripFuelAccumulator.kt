package com.example.obdapp

/** Current-trip estimate over matching observed OBD speed/fuel intervals, including idle. */
internal class TripFuelAccumulator(val vehicleId: String, restored: State? = null) {
    data class State(
        val vehicleId: String,
        val bootCount: Int,
        val startedAtWallMs: Long,
        val lastWallMs: Long,
        val lastElapsedMs: Long,
        val durationMs: Long = 0,
        val coveredMs: Long = 0,
        val distanceKm: Double = 0.0,
        val fuelLitres: Double = 0.0
    ) {
        fun valid(): Boolean = vehicleId.isNotBlank() && startedAtWallMs > 0 && lastWallMs > 0 &&
            lastElapsedMs >= 0 && durationMs in 0..lastElapsedMs && coveredMs in 0..durationMs &&
            distanceKm.isFinite() && distanceKm >= 0.0 && fuelLitres.isFinite() && fuelLitres >= 0.0 &&
            distanceKm <= coveredMs / 3_600_000.0 * 255.0 + 0.000001 &&
            fuelLitres <= coveredMs / 3_600_000.0 * 1000.0 + 0.000001

        fun reading() = TripFuelReading(
            vehicleId,
            (distanceKm / fuelLitres).takeIf { coveredMs > 0 && fuelLitres > 0 && it.isFinite() && it in 0.0..1_000_000.0 },
            if (durationMs > 0) coveredMs.toDouble() / durationMs else 0.0,
            lastElapsedMs
        )
    }

    private data class Point(val elapsedMs: Long, val speed: Double?, val rate: Double?, val session: Long?)
    var state: State? = restored?.takeIf { it.vehicleId == vehicleId && it.valid() }
        private set
    // Deliberately not persisted: never interpolate across process downtime or a vehicle switch.
    private var previous: Point? = null

    fun observe(wallMs: Long, elapsedMs: Long, bootCount: Int, speedKmh: Double?,
                fuelRateLph: Double?, connectionSession: Long?): TripFuelReading? {
        if (wallMs <= 0 || elapsedMs < 0) { previous = null; return state?.reading() }
        var old = state
        if (old != null && old.bootCount == bootCount && elapsedMs <= old.lastElapsedMs) {
            if (elapsedMs < old.lastElapsedMs) previous = null
            return old.reading()
        }
        val gap = old?.let { elapsedMs - it.lastElapsedMs }
        if (old == null || old.bootCount != bootCount || gap == null || gap > TRIP_GAP_MS || gap < 0) {
            old = State(vehicleId, bootCount, wallMs, wallMs, elapsedMs)
            previous = null
        }
        val dt = elapsedMs - old.lastElapsedMs
        val speed = speedKmh?.takeIf { it.isFinite() && it in 0.0..255.0 }
        val rate = fuelRateLph?.takeIf { it.isFinite() && it in 0.0..1000.0 }
        val before = previous
        val paired = dt in 1..MAX_INTERVAL_MS && before != null && before.elapsedMs == old.lastElapsedMs &&
            connectionSession != null && before.session == connectionSession &&
            before.speed != null && speed != null && before.rate != null && rate != null
        val hours = dt / 3_600_000.0
        state = old.copy(lastWallMs = wallMs, lastElapsedMs = elapsedMs,
            durationMs = old.durationMs + dt,
            coveredMs = old.coveredMs + if (paired) dt else 0,
            distanceKm = old.distanceKm + if (paired) (before!!.speed!! + speed!!) / 2 * hours else 0.0,
            fuelLitres = old.fuelLitres + if (paired) (before!!.rate!! + rate!!) / 2 * hours else 0.0)
        previous = Point(elapsedMs, speed, rate, connectionSession)
        return state!!.reading()
    }

    companion object {
        const val TRIP_GAP_MS = 5 * 60 * 1000L
        const val MAX_INTERVAL_MS = 30_000L
    }
}

/** UI projection only; the collector owns accumulation. No mock/UI data enters the totals. */
internal data class TripFuelReading(
    val vehicleId: String,
    val economyKmL: Double?,
    val coverageRatio: Double,
    val sampledAtElapsedMs: Long
) {
    fun current(activeVehicleId: String, nowElapsedMs: Long): TripFuelReading? = takeIf {
        vehicleId == activeVehicleId && sampledAtElapsedMs >= 0 &&
            nowElapsedMs >= sampledAtElapsedMs && nowElapsedMs - sampledAtElapsedMs <= TripFuelAccumulator.TRIP_GAP_MS &&
            coverageRatio.isFinite() && coverageRatio in 0.0..1.0 &&
            (economyKmL == null || economyKmL.isFinite() && economyKmL in 0.0..1_000_000.0)
    }
}
