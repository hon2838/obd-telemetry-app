package com.example.obdapp

import android.content.Context

// Single source of truth for the telemetry backend origin.
// The API Server Config card in MainActivity writes this preference;
// the gateway service, fuel-log sync, and TelemetrySyncWorker all read it.
const val PREFS_NAME = "OBD_PREFS"
const val KEY_API_BASE_URL = "API_BASE_URL"
const val DEFAULT_API_BASE_URL = "https://obd-api.hon2838.name.my"

fun getApiBaseUrl(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(KEY_API_BASE_URL, DEFAULT_API_BASE_URL)?.trim()
        ?.ifEmpty { DEFAULT_API_BASE_URL } ?: DEFAULT_API_BASE_URL
}

fun saveApiBaseUrl(context: Context, baseUrl: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit().putString(KEY_API_BASE_URL, baseUrl.trim()).apply()
}
