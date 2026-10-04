package com.example.obdapp.car

import android.os.SystemClock
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.example.obdapp.GatewayStatusStore
import com.example.obdapp.GatewaySyncState
import com.example.obdapp.R
import com.example.obdapp.VehiclePrefs
import com.example.obdapp.isDeviceConfigured
import kotlinx.coroutines.*

/** A host-rendered status screen; only local configuration and operational snapshots are read. */
internal class DeviceStatusScreen(carContext: CarContext) : Screen(carContext) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var refreshJob: Job? = null
    private var lastView: CarStatusView? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                refreshJob?.cancel()
                refreshJob = scope.launch {
                    while (isActive) {
                        val next = currentView()
                        if (next != lastView) {
                            lastView = next
                            invalidate()
                        }
                        delay(3_000L)
                    }
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                refreshJob?.cancel()
                refreshJob = null
            }

            override fun onDestroy(owner: LifecycleOwner) { scope.cancel() }
        })
    }

    private fun currentView() = CarStatusPresenter.present(
        GatewayStatusStore.status.value, VehiclePrefs.getActiveVehicleId(carContext),
        isDeviceConfigured(carContext), SystemClock.elapsedRealtime()
    )

    override fun onGetTemplate(): Template {
        val view = currentView()
        lastView = view
        if (view.setupRequired) return MessageTemplate.Builder(carContext.getString(R.string.car_phone_setup))
            .setTitle(carContext.getString(R.string.car_status_title))
            .setHeaderAction(Action.APP_ICON).build()

        val adapterText = when (view.adapter) {
            AdapterStatus.STOPPED -> R.string.car_collector_stopped
            AdapterStatus.WAITING -> R.string.car_no_recent_data
            AdapterStatus.CONNECTED -> R.string.car_adapter_connected
            AdapterStatus.DISCONNECTED -> R.string.car_adapter_disconnected
        }
        val syncText = when (view.sync) {
            GatewaySyncState.UNKNOWN -> R.string.car_sync_unknown
            GatewaySyncState.SETUP_REQUIRED -> R.string.car_sync_setup
            GatewaySyncState.OFFLINE -> R.string.car_sync_offline
            GatewaySyncState.UPLOADING -> R.string.car_sync_uploading
            GatewaySyncState.QUEUED -> R.string.car_sync_queued
            GatewaySyncState.SYNCED -> R.string.car_sync_synced
            GatewaySyncState.ERROR -> R.string.car_sync_error
        }
        val pane = Pane.Builder()
            .addRow(row(R.string.car_adapter_title, adapterText))
            .addRow(row(R.string.car_gps_title, if (view.gpsReady) R.string.car_gps_ready else R.string.car_gps_waiting))
            .addRow(row(R.string.car_sync_title, syncText)).build()
        return PaneTemplate.Builder(pane).setTitle(carContext.getString(R.string.car_status_title))
            .setHeaderAction(Action.APP_ICON).build()
    }

    private fun row(title: Int, text: Int) = Row.Builder()
        .setTitle(carContext.getString(title)).addText(carContext.getString(text)).build()
}
