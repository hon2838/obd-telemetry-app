package com.example.obdapp

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/** Foreground phone startup needs no all-the-time location permission. Legacy head units keep theirs. */
internal object GatewayPermissions {
    fun required(sdk: Int, targetSdk: Int): List<String> = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (sdk >= 31 && targetSdk >= 31) {
            add(Manifest.permission.BLUETOOTH_CONNECT)
            add(Manifest.permission.BLUETOOTH_SCAN)
        }
        if (sdk >= 29 && targetSdk < 30) add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }

    fun canAccessBluetooth(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || context.applicationInfo.targetSdkVersion < 31 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    fun granted(context: Context): Boolean = required(Build.VERSION.SDK_INT, context.applicationInfo.targetSdkVersion)
        .all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    fun canPostNotifications(context: Context): Boolean = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}
