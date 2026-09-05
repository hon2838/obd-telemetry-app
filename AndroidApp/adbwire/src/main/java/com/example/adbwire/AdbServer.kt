package com.example.adbwire

import android.os.Build
import android.util.Log
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class AdbServer(
    private val adbPort: Int = 5555,
    private val rawPort: Int = 7777,
    private val onLog: (String) -> Unit
) {
    private val TAG = "AdbServer"
    private val isRunning = AtomicBoolean(false)
    private var adbServerSocket: ServerSocket? = null
    private var rawServerSocket: ServerSocket? = null

    fun start() {
        if (isRunning.getAndSet(true)) return

        // 1. Thread for ADB Wire Protocol on Port 5555 (Loopback only)
        Thread({
            try {
                val loopback = java.net.InetAddress.getByName("127.0.0.1")
                adbServerSocket = ServerSocket(adbPort, 50, loopback)
                onLog("ADB Server listening on 127.0.0.1:$adbPort (Loopback only)")
                Log.i(TAG, "ADB Server started on 127.0.0.1:$adbPort")

                while (isRunning.get()) {
                    val client = adbServerSocket?.accept() ?: break
                    Thread({ handleAdbClient(client) }, "AdbClient-${client.inetAddress.hostAddress}").start()
                }
            } catch (e: Exception) {
                if (isRunning.get()) {
                    onLog("ADB Server error: ${e.message}")
                    Log.e(TAG, "ADB Server error", e)
                }
            }
        }, "AdbListener-5555").start()

        // 2. Thread for Raw Shell (Netcat / Telnet) on Port 7777 (Loopback only)
        Thread({
            try {
                val loopback = java.net.InetAddress.getByName("127.0.0.1")
                rawServerSocket = ServerSocket(rawPort, 50, loopback)
                onLog("Raw Shell listening on 127.0.0.1:$rawPort (Loopback only)")
                Log.i(TAG, "Raw Shell started on 127.0.0.1:$rawPort")

                while (isRunning.get()) {
                    val client = rawServerSocket?.accept() ?: break
                    Thread({ handleRawClient(client) }, "RawClient-${client.inetAddress.hostAddress}").start()
                }
            } catch (e: Exception) {
                if (isRunning.get()) {
                    Log.e(TAG, "Raw Server error", e)
                }
            }
        }, "RawListener-7777").start()
    }

    fun stop() {
        isRunning.set(false)
        try {
            adbServerSocket?.close()
        } catch (_: Exception) {}
        try {
            rawServerSocket?.close()
        } catch (_: Exception) {}
        onLog("Servers stopped.")
    }

    private fun handleAdbClient(socket: Socket) {
        val clientIp = socket.inetAddress.hostAddress
        onLog("[ADB] Client connected from $clientIp")
        var input: InputStream? = null
        var output: OutputStream? = null

        val localIdCounter = AtomicInteger(1)
        val activeProcesses = ConcurrentHashMap<Int, Process>()

        try {
            socket.tcpNoDelay = true
            input = socket.getInputStream()
            output = socket.getOutputStream()

            while (isRunning.get() && !socket.isClosed) {
                val msg = AdbMessage.read(input) ?: break
                when (msg.command) {
                    AdbConstants.A_CNXN -> {
                        val hostBanner = String(msg.payload).trimEnd('\u0000')
                        onLog("[ADB] Handshake from $clientIp: $hostBanner")

                        val devBanner = "device::ro.product.name=${Build.PRODUCT};ro.product.model=${Build.MODEL};ro.product.device=${Build.DEVICE};features=cmd;\u0000"
                        val response = AdbMessage(
                            command = AdbConstants.A_CNXN,
                            arg0 = AdbConstants.A_VERSION,
                            arg1 = AdbConstants.MAX_PAYLOAD,
                            payload = devBanner.toByteArray()
                        )
                        response.write(output)
                        onLog("[ADB] Handshake accepted. Status: CONNECTED")
                    }

                    AdbConstants.A_OPEN -> {
                        val remoteId = msg.arg0
                        val localId = localIdCounter.getAndIncrement()
                        val destination = String(msg.payload).trimEnd('\u0000')
                        val isV2 = destination.startsWith("shell,v2")
                        onLog("[ADB] OPEN stream ($destination) remoteId=$remoteId localId=$localId v2=$isV2")

                        // Acknowledge stream open
                        val okay = AdbMessage(AdbConstants.A_OKAY, localId, remoteId)
                        okay.write(output)

                        // Spawn shell process
                        val proc = spawnShell(destination)
                        activeProcesses[localId] = proc

                        // Pipe process stdout -> ADB WRTE packets to client
                        Thread({
                            try {
                                val procIn = proc.inputStream
                                val buf = ByteArray(1024)
                                while (isRunning.get()) {
                                    val count = procIn.read(buf)
                                    if (count == -1) break
                                    val chunk = buf.copyOf(count)

                                    val payload = if (isV2) {
                                        val p = java.nio.ByteBuffer.allocate(5 + chunk.size).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                                        p.put(1.toByte()) // 1 = STDOUT
                                        p.putInt(chunk.size)
                                        p.put(chunk)
                                        p.array()
                                    } else {
                                        chunk
                                    }

                                    val wrte = AdbMessage(AdbConstants.A_WRTE, localId, remoteId, payload)
                                    output?.let { wrte.write(it) }
                                }

                                if (isV2) {
                                    try { proc.waitFor() } catch (_: Exception) {}
                                    val exitCode = try { proc.exitValue().toByte() } catch (_: Exception) { 0.toByte() }
                                    val exitBuf = java.nio.ByteBuffer.allocate(6).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                                    exitBuf.put(3.toByte()) // 3 = EXIT_CODE
                                    exitBuf.putInt(1)
                                    exitBuf.put(exitCode)
                                    val exitWrte = AdbMessage(AdbConstants.A_WRTE, localId, remoteId, exitBuf.array())
                                    output?.let { exitWrte.write(it) }
                                }
                            } catch (_: Exception) {
                            } finally {
                                val clse = AdbMessage(AdbConstants.A_CLSE, localId, remoteId)
                                try { output?.let { clse.write(it) } } catch (_: Exception) {}
                                proc.destroy()
                                activeProcesses.remove(localId)
                                onLog("[ADB] Stream closed for localId=$localId")
                            }
                        }, "ProcOut-$localId").start()
                    }

                    AdbConstants.A_WRTE -> {
                        val localId = msg.arg1
                        val remoteId = msg.arg0
                        val proc = activeProcesses[localId]

                        if (proc != null && msg.payload.isNotEmpty()) {
                            try {
                                val data = if (msg.payload.size > 5 && (msg.payload[0].toInt() == 0)) {
                                    // shell_v2 stdin framing (0 = stdin, 4 bytes len, data)
                                    val len = java.nio.ByteBuffer.wrap(msg.payload, 1, 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).int
                                    val actualLen = minOf(len, msg.payload.size - 5)
                                    msg.payload.copyOfRange(5, 5 + actualLen)
                                } else {
                                    msg.payload
                                }
                                proc.outputStream.write(data)
                                proc.outputStream.flush()
                            } catch (e: Exception) {
                                Log.e(TAG, "Error writing to process", e)
                            }
                        }

                        // Send flow-control OKAY
                        val okay = AdbMessage(AdbConstants.A_OKAY, localId, remoteId)
                        okay.write(output)
                    }

                    AdbConstants.A_OKAY -> {
                        // Flow control ack from host
                    }

                    AdbConstants.A_CLSE -> {
                        val localId = msg.arg1
                        activeProcesses.remove(localId)?.destroy()
                        onLog("[ADB] Host closed stream localId=$localId")
                    }
                }
            }
        } catch (e: SocketException) {
            onLog("[ADB] Client disconnected: $clientIp")
        } catch (e: Exception) {
            onLog("[ADB] Client error: ${e.message}")
        } finally {
            activeProcesses.values.forEach { it.destroy() }
            activeProcesses.clear()
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun handleRawClient(socket: Socket) {
        val clientIp = socket.inetAddress.hostAddress
        onLog("[RawShell] Direct terminal connected from $clientIp")
        try {
            val proc = ProcessBuilder("/system/bin/sh")
                .redirectErrorStream(true)
                .start()

            val sockIn = socket.getInputStream()
            val sockOut = socket.getOutputStream()
            val procIn = proc.inputStream
            val procOut = proc.outputStream

            sockOut.write("\n=== AdbWire Remote Car Shell (Android ${Build.VERSION.RELEASE}) ===\nType 'exit' to disconnect.\n\n".toByteArray())
            sockOut.flush()

            // Thread 1: Socket -> Process stdin
            val t1 = Thread({
                try {
                    val buf = ByteArray(512)
                    while (isRunning.get()) {
                        val read = sockIn.read(buf)
                        if (read == -1) break
                        procOut.write(buf, 0, read)
                        procOut.flush()
                    }
                } catch (_: Exception) {}
            })
            t1.start()

            // Thread 2: Process stdout -> Socket
            val buf = ByteArray(512)
            while (isRunning.get()) {
                val read = procIn.read(buf)
                if (read == -1) break
                sockOut.write(buf, 0, read)
                sockOut.flush()
            }
            proc.destroy()
            onLog("[RawShell] Disconnected: $clientIp")
        } catch (e: Exception) {
            onLog("[RawShell] Error: ${e.message}")
        } finally {
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun spawnShell(destination: String): Process {
        val pb = ProcessBuilder()
        pb.redirectErrorStream(true)

        val cmd = if (destination.startsWith("shell:")) {
            destination.removePrefix("shell:").trim()
        } else if (destination.startsWith("exec:")) {
            destination.removePrefix("exec:").trim()
        } else if (destination.startsWith("shell,v2")) {
            val colonIdx = destination.indexOf(':', 8)
            if (colonIdx != -1) destination.substring(colonIdx + 1).trim() else ""
        } else {
            ""
        }

        return if (cmd.isNotEmpty()) {
            pb.command("/system/bin/sh", "-c", cmd).start()
        } else {
            pb.command("/system/bin/sh").start()
        }
    }
}
