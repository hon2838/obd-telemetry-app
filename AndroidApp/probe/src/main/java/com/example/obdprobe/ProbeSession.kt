package com.example.obdprobe

import java.io.Closeable
import java.io.IOException

interface ProbeChannel : Closeable {
    fun transact(command: String, timeoutMs: Long = 3500L): String
}

data class ProbeExchange(val command: String, val response: String, val durationMs: Long)

/** No arbitrary-command API: every outgoing command passes the closed allowlist. */
class ProbeSession(private val channel: ProbeChannel, private val record: (ProbeExchange) -> Unit) {
    fun query(command: String, timeoutMs: Long = 3500L): String {
        require(ProbeProtocol.allowed(command)) { "Command is outside the read-only probe policy" }
        val started = System.nanoTime()
        val response = try { channel.transact(command, timeoutMs) } catch (error: Exception) {
            record(ProbeExchange(command, "ERROR: ${error.message}", (System.nanoTime() - started) / 1_000_000L))
            throw error
        }
        record(ProbeExchange(command, response, (System.nanoTime() - started) / 1_000_000L))
        return response
    }

    fun initialize() {
        query("ATZ", 6000L)
        for (command in listOf("ATE0", "ATL0", "ATH0", "ATS1", "ATSP0")) {
            val response = query(command)
            if (!response.contains("OK", ignoreCase = true)) {
                throw IOException("Adapter did not accept $command: $response")
            }
        }
        // Older/clone adapters may not implement CAF. Retain the raw reply.
        query("ATCAF1")
        query("ATI")
        query("ATRV")
    }

    fun discover(mode: Int = 1): Set<Int> {
        require(mode == 1 || mode == 9)
        val result = sortedSetOf<Int>()
        var base = 0
        while (base <= 0xE0) {
            val command = "%02X%02X".format(mode, base)
            val reply = query(command, if (mode == 1 && base == 0) 15_000L else 3500L)
            val pids = ProbeProtocol.supportedPids(reply, mode, base)
            result.addAll(pids.filter { it % 0x20 != 0 })
            if (base + 0x20 !in pids || base == 0xE0 || mode == 9) break
            base += 0x20
        }
        if (mode == 1) {
            query("ATDP")
            query("ATDPN")
        }
        return result
    }

    fun read(pid: Int): String {
        val raw = query("01%02X".format(pid))
        val payloads = ProbeProtocol.payloads(raw, 0x41, pid)
        return if (payloads.isEmpty()) "No valid reading — $raw"
            else payloads.distinct().joinToString(" | ") { ProbeProtocol.decode(pid, it) }
    }
}
