package com.example.obdapp

import android.content.Context

const val PREFS_NAME = "OBD_PREFS"
const val KEY_API_BASE_URL = "API_BASE_URL"
const val DEFAULT_API_BASE_URL = "https://obd-api.hon2838.name.my"
const val KEY_API_KEY = "API_KEY"
const val DEFAULT_API_KEY = "SUPER_SECURE_OBD_APP_KEY_2026"

fun getApiBaseUrl(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(KEY_API_BASE_URL, DEFAULT_API_BASE_URL)?.trim()
        ?.ifEmpty { DEFAULT_API_BASE_URL } ?: DEFAULT_API_BASE_URL
}

fun saveApiBaseUrl(context: Context, baseUrl: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit().putString(KEY_API_BASE_URL, baseUrl.trim()).apply()
}

fun getApiKey(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(KEY_API_KEY, DEFAULT_API_KEY)?.trim()
        ?.ifEmpty { DEFAULT_API_KEY } ?: DEFAULT_API_KEY
}

fun saveApiKey(context: Context, apiKey: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit().putString(KEY_API_KEY, apiKey.trim()).apply()
}
