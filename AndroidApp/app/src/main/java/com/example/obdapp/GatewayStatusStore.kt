package com.example.obdapp

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class GatewaySyncState { UNKNOWN, SETUP_REQUIRED, OFFLINE, UPLOADING, QUEUED, SYNCED, ERROR }

/** Operational state only: this never contains credentials, coordinates, or diagnostic commands. */
data class GatewayStatus(
    val running: Boolean = false,
    val vehicleId: String? = null,
    val adapterConnected: Boolean = false,
    val gpsFix: Boolean = false,
    val gpsFixAtElapsedMs: Long? = null,
    val sampledAtElapsedMs: Long? = null,
    val syncVehicleId: String? = null,
    val syncState: GatewaySyncState = GatewaySyncState.UNKNOWN,
    val syncUpdatedAtElapsedMs: Long? = null
)

/** Shared by the existing collector and all car sessions; no second collector or uploader. */
object GatewayStatusStore {
    private val mutableStatus = MutableStateFlow(GatewayStatus())
    val status: StateFlow<GatewayStatus> = mutableStatus.asStateFlow()

    @Synchronized
    fun setRunning(running: Boolean) {
        mutableStatus.value = if (running) mutableStatus.value.copy(running = true)
            else GatewayStatus()
    }

    @Synchronized
    fun recordSample(vehicleId: String, adapterConnected: Boolean, gpsFixAtElapsedMs: Long?, elapsedMs: Long) {
        val previous = mutableStatus.value
        mutableStatus.value = mutableStatus.value.copy(
            running = true, vehicleId = vehicleId, adapterConnected = adapterConnected,
            gpsFix = gpsFixAtElapsedMs != null, gpsFixAtElapsedMs = gpsFixAtElapsedMs,
            sampledAtElapsedMs = elapsedMs,
            syncState = if (previous.syncVehicleId == vehicleId && previous.syncState == GatewaySyncState.SYNCED)
                GatewaySyncState.QUEUED else previous.syncState
        )
    }

    @Synchronized
    fun recordSync(vehicleId: String, state: GatewaySyncState, elapsedMs: Long) {
        mutableStatus.value = mutableStatus.value.copy(
            syncVehicleId = vehicleId, syncState = state, syncUpdatedAtElapsedMs = elapsedMs
        )
    }
}
