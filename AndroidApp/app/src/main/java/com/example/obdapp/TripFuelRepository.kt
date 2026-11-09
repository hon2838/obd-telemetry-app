package com.example.obdapp

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Log
import org.json.JSONObject

/** One small checkpoint per vehicle; no telemetry-table scan, new PID requests, or network calls. */
internal class TripFuelRepository(context: Context, private val bootCount: Int = readBootCount(context)) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private var active: TripFuelAccumulator? = null
    private var lastCheckpointMs: Long? = null
    private var closed = false

    @Synchronized
    fun observe(vehicleId: String, wallMs: Long, elapsedMs: Long, speedKmh: Double?,
                fuelRateLph: Double?, connectionSession: Long?): TripFuelReading? {
        if (closed || vehicleId.isBlank()) return null
        if (active?.vehicleId != vehicleId) {
            checkpoint()
            active = TripFuelAccumulator(vehicleId, restore(vehicleId, elapsedMs))
            lastCheckpointMs = null
        }
        val reading = active!!.observe(wallMs, elapsedMs, bootCount, speedKmh, fuelRateLph, connectionSession)
        val last = lastCheckpointMs
        if (last == null || elapsedMs < last || elapsedMs - last >= CHECKPOINT_MS) checkpoint()
        return reading
    }

    @Synchronized
    fun close() { checkpoint(); closed = true }

    private fun checkpoint() {
        val state = active?.state ?: return
        if (!state.valid()) return
        val json = JSONObject().put("version", 1).put("vehicle", state.vehicleId).put("boot", state.bootCount)
            .put("start", state.startedAtWallMs).put("wall", state.lastWallMs).put("elapsed", state.lastElapsedMs)
            .put("duration", state.durationMs).put("covered", state.coveredMs)
            .put("distance", state.distanceKm).put("litres", state.fuelLitres)
        val edit = prefs.edit().putString(state.vehicleId, json.toString())
        // Bound storage even if many disposable vehicle profiles have been used.
        val others = prefs.all.filterKeys { it != state.vehicleId }.entries.sortedByDescending {
            try { JSONObject(it.value as? String ?: "").optLong("wall", 0L) } catch (_: Exception) { 0L }
        }
        others.drop(MAX_VEHICLES - 1).forEach { edit.remove(it.key) }
        edit.apply()
        lastCheckpointMs = state.lastElapsedMs
    }

    private fun restore(vehicleId: String, nowElapsedMs: Long): TripFuelAccumulator.State? {
        return try {
            val json = JSONObject(prefs.getString(vehicleId, null) ?: return null)
            if (json.getInt("version") != 1) return null
            val state = TripFuelAccumulator.State(json.getString("vehicle"), json.getInt("boot"),
                json.getLong("start"), json.getLong("wall"), json.getLong("elapsed"), json.getLong("duration"),
                json.getLong("covered"), json.getDouble("distance"), json.getDouble("litres"))
            // Boot identity must be known before reusing a saved monotonic clock. On API23,
            // or unavailable boot identity, a new collector session starts a fresh trip.
            state.takeIf { it.vehicleId == vehicleId && it.valid() && bootCount >= 0 && it.bootCount == bootCount &&
                nowElapsedMs >= it.lastElapsedMs && nowElapsedMs - it.lastElapsedMs <= TripFuelAccumulator.TRIP_GAP_MS }
        } catch (error: Exception) {
            Log.w("TripFuelRepository", "Discarding an invalid trip checkpoint", error)
            null
        }
    }

    companion object {
        const val PREFS = "TRIP_FUEL_PREFS"
        const val CHECKPOINT_MS = 10_000L
        const val MAX_VEHICLES = 32
        private fun readBootCount(context: Context): Int = try {
            if (Build.VERSION.SDK_INT >= 24) Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1) else -1
        } catch (_: Exception) { -1 }
    }
}
