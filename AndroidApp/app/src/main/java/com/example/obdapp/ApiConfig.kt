package com.example.obdapp

import android.content.Context

const val PREFS_NAME = "OBD_PREFS"
const val KEY_API_BASE_URL = "API_BASE_URL"
const val DEFAULT_API_BASE_URL = "https://obd-api.hon2838.name.my"
const val KEY_API_KEY = "API_KEY"

// No literal default key. A previous version shipped
// "SUPER_SECURE_OBD_APP_KEY_2026" in the APK, which made the
// secret recoverable by anyone who installed the app. The
// operator MUST enter the key from the server's deploy config
// (curl /api/admin/agent-config, or the .env / docker-compose
// file). getApiKey() returns the empty string when no key has
// been saved, and the sync worker refuses to post with an
// empty key (so the user gets a clear "no key configured"
// error in the UI instead of silent 401s).
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
