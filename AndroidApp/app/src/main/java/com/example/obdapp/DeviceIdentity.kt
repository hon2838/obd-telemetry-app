package com.example.obdapp

import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

object DeviceIdentity {
    fun getHardwareFingerprint(context: Context, vin: String? = null, btMac: String? = null): JSONObject {
        val androidId = try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        } catch (_: Exception) {
            null
        }

        val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})"

        return JSONObject().apply {
            if (!vin.isNullOrEmpty()) put("vin", vin)
            if (!btMac.isNullOrEmpty()) put("btMac", btMac)
            if (!androidId.isNullOrEmpty()) put("androidId", androidId)
            put("deviceModel", deviceModel)
        }
    }
}
