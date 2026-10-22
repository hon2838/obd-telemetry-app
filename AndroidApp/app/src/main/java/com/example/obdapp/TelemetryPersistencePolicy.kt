package com.example.obdapp

import kotlin.math.abs

internal class TelemetryPersistencePolicy(
    private val stationaryHeartbeatMs: Long = STATIONARY_HEARTBEAT_MS
) {
    companion object {
        const val STATIONARY_HEARTBEAT_MS = 20_000L
        const val STATIONARY_SPEED_THRESHOLD_KMH = 1.0f
        const val COORDINATE_EPSILON_DEG = 0.00005
        const val VOLTAGE_CHANGE_THRESHOLD = 0.2f
    }

    private var lastPersisted: TelemetryEntity? = null
    private var lastObdConnected: Boolean = false
    private var lastHasGpsFix: Boolean = false

    @Synchronized
    fun shouldPersist(sample: TelemetryEntity, obdConnected: Boolean, hasGpsFix: Boolean): Boolean {
        val last = lastPersisted
        val shouldSave = when {
            // 1. First sample or vehicle switch
            last == null || sample.vehicleId != last.vehicleId -> true

            // 2. OBD connected or dense OBD / moving samples present
            obdConnected || sample.rpm != null || sample.speed != null || sample.accelTime != null -> true

            // 3. Movement detected by GPS speed, transition to stationary, or coordinate change
            sample.gpsSpeed >= STATIONARY_SPEED_THRESHOLD_KMH -> true
            last.gpsSpeed >= STATIONARY_SPEED_THRESHOLD_KMH -> true
            hasGpsFix && (abs(sample.latitude - last.latitude) > COORDINATE_EPSILON_DEG ||
                abs(sample.longitude - last.longitude) > COORDINATE_EPSILON_DEG) -> true

            // 4. Any state transition compared to last persisted sample
            obdConnected != lastObdConnected -> true
            hasGpsFix != lastHasGpsFix -> true
            sample.accOn != last.accOn -> true
            sample.headlightOn != last.headlightOn -> true
            sample.alertCoolant == true || sample.alertCoolant != last.alertCoolant -> true
            sample.alertVoltage == true || sample.alertVoltage != last.alertVoltage -> true
            sample.btConnected != last.btConnected -> true
            sample.coolantTemp != last.coolantTemp -> true
            hasMeaningfulVoltageChange(sample.voltage, last.voltage) -> true

            // 5. Heartbeat elapsed or clock moved backwards
            sample.timestamp - last.timestamp >= stationaryHeartbeatMs -> true
            sample.timestamp < last.timestamp -> true

            else -> false
        }

        if (shouldSave) {
            lastPersisted = sample
            lastObdConnected = obdConnected
            lastHasGpsFix = hasGpsFix
        }

        return shouldSave
    }

    private fun hasMeaningfulVoltageChange(current: Float?, previous: Float?): Boolean {
        if (current == null && previous == null) return false
        if (current == null || previous == null) return true
        val delta = abs(current - previous)
        return delta >= (VOLTAGE_CHANGE_THRESHOLD - 0.0005f)
    }

    @Synchronized
    fun reset() {
        lastPersisted = null
        lastObdConnected = false
        lastHasGpsFix = false
    }
}
