package com.example.obdapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            context?.let { ctx ->
                val prefs = ctx.getSharedPreferences("OBD_PREFS", Context.MODE_PRIVATE)
                val autoStart = prefs.getBoolean("AUTO_START_BOOT", true)
                if (autoStart) {
                    val serviceIntent = Intent(ctx, OBDGatewayService::class.java)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        ctx.startForegroundService(serviceIntent)
                    } else {
                        ctx.startService(serviceIntent)
                    }
                }
            }
        }
    }
}
