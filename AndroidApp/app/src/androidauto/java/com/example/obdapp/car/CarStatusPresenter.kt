package com.example.obdapp.car

import com.example.obdapp.GatewayStatus
import com.example.obdapp.GatewaySyncState
import com.example.obdapp.GpsTelemetryPolicy

internal enum class AdapterStatus { STOPPED, WAITING, CONNECTED, DISCONNECTED }
internal data class CarStatusView(
    val setupRequired: Boolean,
    val adapter: AdapterStatus,
    val gpsReady: Boolean,
    val sync: GatewaySyncState
)

/** Pure mapping keeps freshness and vehicle isolation independent of Android Auto's renderer. */
internal object CarStatusPresenter {
    private const val SAMPLE_MAX_AGE_MS = 15_000L
    private const val SYNC_MAX_AGE_MS = 120_000L

    fun present(status: GatewayStatus, vehicleId: String, configured: Boolean, elapsedMs: Long): CarStatusView {
        val freshSample = status.running && status.vehicleId == vehicleId &&
            fresh(status.sampledAtElapsedMs, elapsedMs, SAMPLE_MAX_AGE_MS)
        val adapter = when {
            !status.running -> AdapterStatus.STOPPED
            !freshSample -> AdapterStatus.WAITING
            status.adapterConnected -> AdapterStatus.CONNECTED
            else -> AdapterStatus.DISCONNECTED
        }
        val sync = when {
            !configured -> GatewaySyncState.SETUP_REQUIRED
            status.syncVehicleId != vehicleId -> GatewaySyncState.UNKNOWN
            !fresh(status.syncUpdatedAtElapsedMs, elapsedMs, SYNC_MAX_AGE_MS) -> GatewaySyncState.UNKNOWN
            else -> status.syncState
        }
        val gpsReady = freshSample && status.gpsFix &&
            fresh(status.gpsFixAtElapsedMs, elapsedMs, GpsTelemetryPolicy.DEFAULT_COORDINATE_MAX_AGE_MS)
        return CarStatusView(!configured, adapter, gpsReady, sync)
    }

    private fun fresh(timestamp: Long?, now: Long, limit: Long): Boolean =
        timestamp != null && timestamp >= 0 && now >= timestamp && now - timestamp <= limit
}
