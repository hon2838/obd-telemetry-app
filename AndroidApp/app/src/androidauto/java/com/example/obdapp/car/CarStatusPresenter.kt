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

internal data class LiveGaugesView(
    val speedValue: String,
    val speedSource: String,
    val rpmValue: String,
    val coolantValue: String,
    val voltageValue: String,
    val fuelEconomyValue: String,
    val fuelEconomyUnit: String,
    val loadValue: String
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

    fun presentGauges(status: GatewayStatus, vehicleId: String, elapsedMs: Long): LiveGaugesView {
        val gauges = status.liveGauges
        val fresh = status.running && status.vehicleId == vehicleId &&
            gauges != null && fresh(gauges.sampledAtElapsedMs, elapsedMs, SAMPLE_MAX_AGE_MS)

        if (!fresh) {
            return LiveGaugesView(
                speedValue = "--",
                speedSource = "",
                rpmValue = "--",
                coolantValue = "--",
                voltageValue = "--",
                fuelEconomyValue = "--",
                fuelEconomyUnit = "km/L",
                loadValue = "--"
            )
        }

        val speedStr = if (gauges.speedKmh != null && gauges.speedKmh >= 0f) {
            String.format(java.util.Locale.US, "%.0f km/h", gauges.speedKmh)
        } else "--"

        val rpmStr = if (gauges.rpm != null && gauges.rpm >= 0) {
            "${gauges.rpm} RPM"
        } else "--"

        val coolantStr = if (gauges.coolantTemp != null) {
            "${gauges.coolantTemp} °C"
        } else "--"

        val voltageStr = if (gauges.voltage != null && gauges.voltage >= 0f) {
            String.format(java.util.Locale.US, "%.1f V", gauges.voltage)
        } else "--"

        val (fuelStr, fuelUnit) = when {
            gauges.fuelRateLph != null && gauges.fuelRateLph >= 0.0 && (gauges.speedKmh == null || gauges.speedKmh < 1.0f) -> {
                String.format(java.util.Locale.US, "%.1f", gauges.fuelRateLph) to "L/h"
            }
            gauges.fuelEconomyKmL != null && gauges.fuelEconomyKmL >= 0.0 -> {
                String.format(java.util.Locale.US, "%.1f", gauges.fuelEconomyKmL) to "km/L"
            }
            else -> "--" to "km/L"
        }

        val loadStr = if (gauges.engineLoad != null && gauges.engineLoad >= 0) {
            "${gauges.engineLoad} %"
        } else "--"

        return LiveGaugesView(
            speedValue = speedStr,
            speedSource = gauges.speedSource,
            rpmValue = rpmStr,
            coolantValue = coolantStr,
            voltageValue = voltageStr,
            fuelEconomyValue = fuelStr,
            fuelEconomyUnit = fuelUnit,
            loadValue = loadStr
        )
    }

    private fun fresh(timestamp: Long?, now: Long, limit: Long): Boolean =
        timestamp != null && timestamp >= 0 && now >= timestamp && now - timestamp <= limit
}
