package com.example.adbwire

import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.net.Inet4Address
import java.net.NetworkInterface

class MainActivity : AppCompatActivity() {

    private lateinit var statusDot: View
    private lateinit var tvStatus: TextView
    private lateinit var btnToggleServer: Button
    private lateinit var tvIpAddress: TextView
    private lateinit var tvInstructions: TextView
    private lateinit var tvLogs: TextView
    private lateinit var scrollLogs: ScrollView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusDot = findViewById(R.id.statusDot)
        tvStatus = findViewById(R.id.tvStatus)
        btnToggleServer = findViewById(R.id.btnToggleServer)
        tvIpAddress = findViewById(R.id.tvIpAddress)
        tvInstructions = findViewById(R.id.tvInstructions)
        tvLogs = findViewById(R.id.tvLogs)
        scrollLogs = findViewById(R.id.scrollLogs)

        val ip = getDeviceIpAddress()
        tvIpAddress.text = "Car Player IP: $ip"
        tvInstructions.text = "# Method 1 (Standard ADB):\nadb connect $ip:5555\nadb shell\n\n# Method 2 (Raw Netcat):\nnc $ip 7777"

        btnToggleServer.setOnClickListener {
            if (AdbServerService.isServiceRunning) {
                stopServerService()
            } else {
                startServerService()
            }
        }

        AdbServerService.logListener = { logMsg ->
            runOnUiThread {
                appendLog(logMsg)
            }
        }

        // Auto-start server if not already running
        if (!AdbServerService.isServiceRunning) {
            startServerService()
        } else {
            updateUi(true)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        AdbServerService.logListener = null
    }

    private fun startServerService() {
        val intent = Intent(this, AdbServerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(this, intent)
        } else {
            startService(intent)
        }
        updateUi(true)
        appendLog("[System] AdbWire service started on ports 5555 & 7777")
    }

    private fun stopServerService() {
        val intent = Intent(this, AdbServerService::class.java)
        stopService(intent)
        updateUi(false)
        appendLog("[System] AdbWire service stopped")
    }

    private fun updateUi(running: Boolean) {
        if (running) {
            statusDot.setBackgroundColor(ContextCompat.getColor(this, R.color.accent_green))
            tvStatus.text = "Server: RUNNING (Ports 5555 & 7777)"
            btnToggleServer.text = "STOP"
            btnToggleServer.setBackgroundColor(ContextCompat.getColor(this, R.color.accent_red))
        } else {
            statusDot.setBackgroundColor(ContextCompat.getColor(this, R.color.accent_red))
            tvStatus.text = "Server: STOPPED"
            btnToggleServer.text = "START"
            btnToggleServer.setBackgroundColor(ContextCompat.getColor(this, R.color.accent_cyan))
        }
    }

    private fun appendLog(text: String) {
        val current = tvLogs.text.toString()
        val newText = "$current\n$text"
        tvLogs.text = if (newText.length > 5000) newText.takeLast(4000) else newText
        scrollLogs.post { scrollLogs.fullScroll(ScrollView.FOCUS_DOWN) }
    }

    private fun getDeviceIpAddress(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        return addr.hostAddress ?: "127.0.0.1"
                    }
                }
            }
        } catch (_: Exception) {}
        return "192.168.100.3"
    }
}
