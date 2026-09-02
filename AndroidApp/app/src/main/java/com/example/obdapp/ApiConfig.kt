package com.example.obdapp

import android.content.Context
import java.net.HttpURLConnection

const val PREFS_NAME = "OBD_PREFS"
const val KEY_API_BASE_URL = "API_BASE_URL"
const val DEFAULT_API_BASE_URL = "https://obd-api.hon2838.name.my"
const val KEY_API_KEY = "API_KEY"
const val KEY_DEVICE_TOKEN = "DEVICE_TOKEN"
const val DEFAULT_API_KEY = ""

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
        ?: DEFAULT_API_KEY
}

fun saveApiKey(context: Context, apiKey: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit().putString(KEY_API_KEY, apiKey.trim()).apply()
}

fun getDeviceToken(context: Context): String? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(KEY_DEVICE_TOKEN, null)?.trim()?.takeIf { it.isNotEmpty() }
}

fun saveDeviceToken(context: Context, token: String?) {
    val editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (token.isNullOrEmpty()) {
        editor.remove(KEY_DEVICE_TOKEN)
    } else {
        editor.putString(KEY_DEVICE_TOKEN, token.trim())
    }
    editor.apply()
}

fun isDeviceConfigured(context: Context): Boolean {
    return !getDeviceToken(context).isNullOrEmpty() || getApiKey(context).isNotEmpty()
}

fun applyAuthHeader(connection: HttpURLConnection, context: Context) {
    val deviceToken = getDeviceToken(context)
    if (!deviceToken.isNullOrEmpty()) {
        connection.setRequestProperty("X-Device-Token", deviceToken)
    } else {
        val apiKey = getApiKey(context)
        if (apiKey.isNotEmpty()) {
            connection.setRequestProperty("X-API-Key", apiKey)
        }
    }
}
