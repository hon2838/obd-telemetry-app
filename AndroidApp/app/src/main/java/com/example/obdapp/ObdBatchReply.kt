package com.example.obdapp

import com.github.eltonvs.obd.command.ObdCommand
import com.github.eltonvs.obd.command.ObdRawResponse
import java.io.IOException

internal class BatchPidCommand(pids: List<String>) : ObdCommand() {
    override val tag = "SENSOR_BATCH"
    override val name = "Read supported sensors together"
    override val mode = "01"
    override val pid = pids.joinToString(" ")
    override val skipDigitCheck = true
}

/** Decode one coherent Mode 01 message; never combine values from separate ECUs. */
internal object ObdBatchReply {
    val lengths = mapOf(
        "03" to 2, "04" to 1, "05" to 1, "0B" to 1, "0C" to 2, "0D" to 1,
        "0F" to 1, "10" to 2, "11" to 1, "2F" to 1, "42" to 2, "45" to 1, "46" to 1
    )

    fun decode(reply: ObdRawResponse, requested: List<String>): Map<String, ObdRawResponse> {
        if (requested.size !in 2..6 || requested.distinct().size != requested.size ||
            requested.any { it !in lengths }) throw IOException("Invalid sensor batch")
        val lines = reply.value.lineSequence().map { it.trim().uppercase() }.filter { it.isNotEmpty() }.toList()
        if (lines.isEmpty() || lines.size > 12) throw IOException("Invalid batch framing")
        val payload = if (Regex("[0-9A-F]{3}").matches(lines[0])) {
            val length = lines[0].toInt(16)
            if (length !in 1..32) throw IOException("Invalid batch payload length")
            val bytes = mutableListOf<Int>()
            for ((index, line) in lines.drop(1).withIndex()) {
                val parts = line.split(':', limit = 2)
                if (parts.size != 2 || parts[0].trim() != index.toString(16).uppercase()) {
                    throw IOException("Missing or mixed batch fragment")
                }
                val frame = hexBytes(parts[1])
                if (frame.size !in 1..7) throw IOException("Invalid batch fragment length")
                bytes.addAll(frame)
            }
            if (bytes.size < length || bytes.size - length > 6) throw IOException("Truncated batch reply")
            bytes.take(length)
        } else {
            if (lines.size != 1) throw IOException("Multiple ECU messages cannot be combined")
            hexBytes(lines.single())
        }
        if (payload.firstOrNull() != 0x41) throw IOException("Wrong batch response mode")
        val decoded = linkedMapOf<String, ObdRawResponse>()
        var position = 1
        while (position < payload.size) {
            val pid = "%02X".format(java.util.Locale.US, payload[position++])
            val length = lengths[pid] ?: throw IOException("Unknown batch PID")
            if (pid !in requested || pid in decoded || position + length > payload.size) {
                throw IOException("Incomplete or duplicate sensor batch")
            }
            val value = payload.subList(position, position + length).joinToString(" ") {
                "%02X".format(java.util.Locale.US, it)
            }
            decoded[pid] = ObdRawResponse("41 $pid $value", reply.elapsedTime)
            position += length
        }
        if (decoded.keys != requested.toSet()) throw IOException("Sensor batch omitted requested values")
        return decoded
    }

    private fun hexBytes(text: String): List<Int> {
        val hex = text.filterNot { it.isWhitespace() }
        if (hex.isEmpty() || hex.length % 2 != 0 || hex.length > 64 ||
            hex.any { it !in '0'..'9' && it !in 'A'..'F' }) throw IOException("Invalid batch hex")
        return hex.chunked(2).map { it.toInt(16) }
    }
}
