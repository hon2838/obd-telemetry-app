package com.example.obdapp.car

import androidx.car.app.CarContext
import androidx.car.app.Screen

/** Isolated private build; inherits the same debug/release host validation as OBD Connect. */
class PersonalCarAppService : ObdCarAppService() {
    override fun createRootScreen(carContext: CarContext): Screen = PersonalCockpitScreen(carContext)
}
