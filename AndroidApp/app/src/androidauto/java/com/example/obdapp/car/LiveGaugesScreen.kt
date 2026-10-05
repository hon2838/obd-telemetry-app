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

        val speedSubtitle = if (view.speedSource.isNotEmpty()) {
            "${carContext.getString(R.string.car_gauge_speed)} (${view.speedSource})"
        } else {
            carContext.getString(R.string.car_gauge_speed)
        }

        val fuelSubtitle = "${carContext.getString(R.string.car_gauge_fuel)} (${view.fuelEconomyUnit})"

        val itemList = ItemList.Builder()
            .addItem(gridItem(view.speedValue, speedSubtitle))
            .addItem(gridItem(view.rpmValue, carContext.getString(R.string.car_gauge_rpm)))
            .addItem(gridItem(view.coolantValue, carContext.getString(R.string.car_gauge_coolant)))
            .addItem(gridItem(view.voltageValue, carContext.getString(R.string.car_gauge_voltage)))
            .addItem(gridItem(view.fuelEconomyValue, fuelSubtitle))
            .addItem(gridItem(view.loadValue, carContext.getString(R.string.car_gauge_load)))
            .build()

        return GridTemplate.Builder()
            .setTitle(carContext.getString(R.string.car_gauges_title))
            .setHeaderAction(Action.BACK)
            .setSingleList(itemList)
            .build()
    }

    private fun gridItem(title: String, subtitle: String): GridItem =
        GridItem.Builder()
            .setImage(CarIcon.Builder(IconCompat.createWithResource(carContext, R.drawable.ic_gauge_tile)).build())
            .setTitle(title)
            .setText(subtitle)
            .build()
}
