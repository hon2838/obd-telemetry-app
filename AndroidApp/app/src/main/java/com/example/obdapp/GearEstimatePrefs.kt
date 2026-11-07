package com.example.obdapp

import android.content.Context

internal object GearEstimatePrefs {
    private const val NAME = "GEAR_ESTIMATE_PREFS"
    fun enabled(context: Context, vehicleId: String): Boolean =
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE).getBoolean("axia_4at_$vehicleId", false)

    fun setEnabled(context: Context, vehicleId: String, enabled: Boolean) {
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit()
            .putBoolean("axia_4at_$vehicleId", enabled).apply()
    }
}
