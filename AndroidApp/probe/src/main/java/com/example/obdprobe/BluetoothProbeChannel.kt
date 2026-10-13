package com.example.obdprobe

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.os.SystemClock
import java.io.IOException
import java.util.Timer
import java.util.TimerTask
import java.util.UUID

/** Only one serial command in flight; timeout/overflow closes the link to avoid stale replies. */
@SuppressLint("MissingPermission")
class BluetoothProbeChannel(device: BluetoothDevice, insecure: Boolean) : ProbeChannel {
    private val socket: BluetoothSocket
    @Volatile private var closed = false

    init {
        val spp = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        socket = if (insecure) device.createInsecureRfcommSocketToServiceRecord(spp)
            else device.createRfcommSocketToServiceRecord(spp)
    }

    fun connect() {
        val watchdog = Timer("obd-probe-connect", true)
        watchdog.schedule(object : TimerTask() { override fun run() { close() } }, 15_000L)
        try {
            if (closed) throw IOException("Connection cancelled")
            socket.connect()
            if (closed) throw IOException("Connection timed out")
        } catch (error: IOException) {
            close()
            throw error
        } finally { watchdog.cancel() }
    }

    @Synchronized override fun transact(command: String, timeoutMs: Long): String {
        require(ProbeProtocol.allowed(command)) { "Unsupported probe command" }
        require(timeoutMs in 1..15_000L)
        if (closed) throw IOException("Adapter disconnected")
        val response = StringBuilder()
        try {
            socket.outputStream.write((command + "\r").toByteArray(Charsets.US_ASCII))
            socket.outputStream.flush()
            val deadline = SystemClock.elapsedRealtime() + timeoutMs
            val input = socket.inputStream
            while (SystemClock.elapsedRealtime() < deadline) {
                if (closed) throw IOException("Probe stopped")
                if (input.available() == 0) {
                    Thread.sleep(10)
                    continue
                }
                val next = input.read()
                if (next < 0) throw IOException("Adapter closed its serial port")
                if (next == '>'.code) return response.toString().trim()
                response.append(next.toChar())
                if (response.length > 32_768) throw IOException("Adapter reply exceeded 32 KiB")
            }
            throw IOException("No complete adapter reply for $command within ${timeoutMs / 1000.0}s; reconnect to retry. Partial reply: ${response.take(4096)}")
        } catch (error: Exception) {
            close()
            throw error
        }
    }

    override fun close() {
        closed = true
        try { socket.close() } catch (_: IOException) { }
    }
}
