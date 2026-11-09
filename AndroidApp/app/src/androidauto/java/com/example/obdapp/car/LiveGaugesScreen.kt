package com.example.obdapp.car

import android.os.SystemClock
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.GridItem
import androidx.car.app.model.ItemList
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.CarIcon
import androidx.core.graphics.drawable.IconCompat
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.example.obdapp.GatewayStatusStore
import com.example.obdapp.R
import com.example.obdapp.VehiclePrefs
import kotlinx.coroutines.*

/** A host-rendered live gauges screen displaying OBD & GPS metrics in a 6-card grid. */
internal class LiveGaugesScreen(carContext: CarContext) : Screen(carContext) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var refreshJob: Job? = null
    private var lastView: LiveGaugesView? = null

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
                        delay(1_000L)
                    }
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                refreshJob?.cancel()
                refreshJob = null
            }

            override fun onDestroy(owner: LifecycleOwner) {
                scope.cancel()
            }
        })
    }

    private fun currentView(): LiveGaugesView = CarStatusPresenter.presentGauges(
        GatewayStatusStore.status.value,
        VehiclePrefs.getActiveVehicleId(carContext),
        SystemClock.elapsedRealtime()
    )

    override fun onGetTemplate(): Template {
        val view = currentView()
        lastView = view

        val speedReading = if (view.speedValue != "--" && view.speedSource.isNotEmpty()) {
            "${view.speedValue} · ${view.speedSource}"
        } else view.speedValue
        val fuelReading = if (view.fuelEconomyValue != "--") {
            "${view.fuelEconomyValue} ${view.fuelEconomyUnit}"
        } else view.fuelEconomyValue

        // Grid refreshes require stable item titles. Values, source and units belong
        // in secondary text so normal sensor updates do not consume task templates.
        val itemList = ItemList.Builder()
            .addItem(gridItem(R.string.car_gauge_speed, speedReading))
            .addItem(gridItem(R.string.car_gauge_rpm, view.rpmValue))
            .addItem(gridItem(R.string.car_gauge_coolant, view.coolantValue))
            .addItem(gridItem(R.string.car_gauge_voltage, view.voltageValue))
            .addItem(gridItem(R.string.car_gauge_fuel, fuelReading))
            .addItem(gridItem(R.string.car_gauge_load, view.loadValue))
            .build()

        return GridTemplate.Builder()
            .setTitle(carContext.getString(R.string.car_gauges_title))
            .setHeaderAction(Action.BACK)
            .setSingleList(itemList)
            .build()
    }

    private fun gridItem(title: Int, reading: String): GridItem =
        GridItem.Builder()
            .setImage(CarIcon.Builder(IconCompat.createWithResource(carContext, R.drawable.ic_gauge_tile)).build())
            .setTitle(carContext.getString(title))
            .setText(reading)
            .build()
}
