package com.example.obdprobe

import java.util.Locale
import kotlin.math.round

/**
 * Pure-Kotlin ELM327/OBD-II protocol helpers for the independent `probe` module.
 *
 * No Android dependencies, no I/O, no transport. All parsing is bounded
 * (see MAX_* constants) so hostile or garbage adapter replies cannot cause
 * unbounded allocation or looping.
 *
 * Assumed adapter setup (owned by the transport layer, not here):
 * ATE0 ATL0 ATH0 ATS1 ATCAF1 ATSP0.
 */
object ProbeProtocol {

    private const val MAX_REPLY_CHARS = 8192
    private const val MAX_SEGMENTS = 32
    private const val MAX_TOKENS_PER_SEGMENT = 256
    private const val MAX_BYTES_PER_SEGMENT = 512
    private const val MAX_FRAMES = 16
    private const val MAX_PAYLOAD_BYTES = 64

    /** Expected data-byte length for fixed-length Mode 01 PIDs (null = variable). */
    private fun knownLength(pid: Int): Int? = when (pid) {
        0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0, 0xE0 -> 4
        0x01 -> 4
        0x04, 0x05, 0x0D, 0x0F, 0x11, 0x2F, 0x46, 0x5C -> 1
        0x0C, 0x10, 0x1F, 0x42 -> 2
        else -> null
    }

    /**
     * Split a raw ELM reply into per-line byte lists.
     *
     * Tolerates: spaced (`41 00 BE ...`) and compact (`4100BE...`) hex,
     * command echo (`0100`), `SEARCHING...` prefixes (attached or not),
     * `>` prompts, numbered multiline fragments (`0: ...`), and error text
     * (`NO DATA`, `STOPPED`, `?`, ...). Only whitespace-delimited tokens that
     * are entirely even-length hex are accepted, so error words such as
     * `DATA` (contains `T`) can never inject phantom bytes.
     */
    private fun segmentByteLists(reply: String): List<List<Int>> {
        val out = mutableListOf<List<Int>>()
        for (line in reply.take(MAX_REPLY_CHARS).split('\r', '\n', '>').take(MAX_SEGMENTS)) {
            val clean = line.uppercase(Locale.US)
                .replace("SEARCHING...", "")
                .replace(Regex("^[0-9A-F]{1,2}:\\s*"), "")
                .trim()
            if (clean.isEmpty()) continue
            val tokens = clean.split(Regex("\\s+"))
            if (tokens.size > MAX_TOKENS_PER_SEGMENT) continue
            // Reject an entire malformed frame; dropping bad tokens can fabricate data.
            if (tokens.any { it.length < 2 || it.length % 2 != 0 ||
                    it.any { char -> char !in '0'..'9' && char !in 'A'..'F' } }) continue
            val hex = tokens.joinToString("")
            if (hex.length > MAX_BYTES_PER_SEGMENT * 2) continue
            out += hex.chunked(2).map { it.toInt(16) }
        }
        return out
    }

    /**
     * Capability mask query (e.g. `0100` -> `41 00 ...`).
     *
     * @param mode supported read mode (1 or 9); response mode is `mode + 0x40`.
     * @param base mask base PID: one of 00/20/40/60/80/A0/C0/E0.
     * @return union of supported PIDs across all valid ECU replies.
     * A frame counts only when it carries *exactly* 4 mask bytes: MSB is
     * `base+1`, LSB is `base+32`. Truncated, over-long, wrong-PID, wrong-mode,
     * `7F xx xx` negative-response and error-text frames never count.
     */
    fun supportedPids(reply: String, mode: Int = 1, base: Int = 0): Set<Int> {
        if (mode !in listOf(1, 9) || base !in 0..0xE0 || base % 0x20 != 0) return emptySet()
        val found = linkedSetOf<Int>()
        for (mask in payloads(reply, mode + 0x40, base).filter { it.size == 4 }) {
            for (bit in 0 until 32) {
                if ((mask[bit / 8] shr (7 - bit % 8)) and 1 == 1) found += base + bit + 1
            }
        }
        return found
    }

    /**
     * Payloads for one `(responseMode, pid)` header across all ECU replies.
     *
     * Fixed-length PIDs take exactly [knownLength] bytes (truncated frames are
     * dropped); variable-length PIDs retain the whole bounded payload in that segment. `7F` / error-text / wrong-PID data never matches.
     */
    fun payloads(reply: String, responseMode: Int, pid: Int): List<List<Int>> {
        if (responseMode !in listOf(0x41, 0x49) || pid !in 0..0xFF) return emptyList()
        val out = mutableListOf<List<Int>>()
        val fixed = if (responseMode == 0x41) knownLength(pid)
            else if (pid % 0x20 == 0) 4 else null
        for (segment in segmentByteLists(reply)) {
            var offset = 0
            // A request echo can precede its response on the same line.
            if (segment.take(2) == listOf(responseMode - 0x40, pid)) offset = 2
            while (offset + 2 <= segment.size && out.size < MAX_FRAMES) {
                // Headers-off replies start with the service and PID. Never search
                // inside another service's data for bytes resembling a header.
                if (segment[offset] != responseMode || segment[offset + 1] != pid) break
                if (fixed == null) {
                    val payload = segment.drop(offset + 2).take(MAX_PAYLOAD_BYTES)
                    if (payload.isNotEmpty()) out += payload
                    break
                }
                val end = offset + 2 + fixed
                if (end > segment.size) break
                val hasAnotherFrame = end + 2 <= segment.size &&
                    segment[end] == responseMode && segment[end + 1] == pid
                if (end != segment.size && !hasAnotherFrame) break
                out += segment.subList(offset + 2, end).toList()
                offset = end
            }
        }
        return out.take(MAX_FRAMES)
    }

    private fun rawHex(bytes: List<Int>): String =
        bytes.joinToString(" ") { "%02X".format(Locale.US, it and 0xFF) }

    /** Round to 2 decimals, then strip trailing zeros: 12.60 -> "12.6". */
    private fun fmt(v: Double): String {
        val rounded = round(v * 100.0) / 100.0
        if (!rounded.isFinite()) return "?"
        if (rounded == kotlin.math.floor(rounded)) return rounded.toLong().toString()
        return "%.2f".format(Locale.US, rounded).trimEnd('0').trimEnd('.')
    }

    /**
     * Human-readable value for standard Mode 01 sensors. Insufficient bytes or
     * unknown PIDs yield spaced uppercase raw hex (never invented units);
     * empty input yields "".
     */
    fun decode(pid: Int, bytes: List<Int>): String {
        fun need(n: Int): List<Int>? = if (bytes.size >= n) bytes else null
        return when (pid) {
            0x0C -> {
                val b = need(2) ?: return rawHex(bytes)
                "${fmt((b[0] * 256 + b[1]) / 4.0)} rpm"
            }
            0x0D -> {
                val b = need(1) ?: return rawHex(bytes)
                "${b[0]} km/h"
            }
            0x04, 0x11, 0x2F -> {
                val b = need(1) ?: return rawHex(bytes)
                "${fmt(b[0] * 100.0 / 255.0)} %"
            }
            0x05, 0x0F, 0x46, 0x5C -> {
                val b = need(1) ?: return rawHex(bytes)
                "${b[0] - 40} C"
            }
            0x42 -> {
                val b = need(2) ?: return rawHex(bytes)
                "${fmt((b[0] * 256 + b[1]) / 1000.0)} V"
            }
            0x10 -> {
                val b = need(2) ?: return rawHex(bytes)
                "${fmt((b[0] * 256 + b[1]) / 100.0)} g/s"
            }
            0x1F -> {
                val b = need(2) ?: return rawHex(bytes)
                "${b[0] * 256 + b[1]} s"
            }
            else -> rawHex(bytes)
        }
    }

    /** Display label for standard Mode 01 PIDs; unknown -> "PID XX". */
    fun label(pid: Int): String = when (pid) {
        0x00 -> "Supported PIDs 01-20"
        0x01 -> "Monitor Status"
        0x04 -> "Engine Load"
        0x05 -> "Coolant Temperature"
        0x0C -> "Engine RPM"
        0x0D -> "Vehicle Speed"
        0x0F -> "Intake Air Temperature"
        0x10 -> "MAF Air Flow"
        0x11 -> "Throttle Position"
        0x1F -> "Engine Runtime"
        0x20 -> "Supported PIDs 21-40"
        0x2F -> "Fuel Level"
        0x40 -> "Supported PIDs 41-60"
        0x42 -> "Control Module Voltage"
        0x46 -> "Ambient Temperature"
        0x5C -> "Engine Oil Temperature"
        0x60 -> "Supported PIDs 61-80"
        0x80 -> "Supported PIDs 81-A0"
        0xA0 -> "Supported PIDs A1-C0"
        0xC0 -> "Supported PIDs C1-E0"
        0xE0 -> "Supported PIDs E1-100"
        else -> "PID %02X".format(Locale.US, pid and 0xFF)
    }

    private val AT_ALLOW = setOf(
        "ATZ", "ATE0", "ATL0", "ATH0", "ATS1", "ATCAF1", "ATSP0",
        "ATI", "ATDP", "ATDPN", "ATRV"
    )
    private val MODE09_ALLOW = setOf("0900", "0902", "0904", "0906", "090A")

    /**
     * Closed command allowlist. Normalizes case and inter-byte spaces, but any
     * CR/LF/semicolon in the raw command is an injection attempt -> false.
     * Allowed: init/status AT commands above, exact 2-byte Mode 01 requests
     * (`01xx`), Mode 09 (`0900/0902/0904/0906/090A`), bare DTC modes
     * (`03`/`07`/`0A`). Everything else (04/08/UDS 22xx/raw CAN/ATSH/...) -> false.
     */
    fun allowed(command: String): Boolean {
        if (command.length !in 1..32) return false
        for (c in command) {
            if (c == '\r' || c == '\n' || c == ';') return false
        }
        val norm = command.trim().uppercase(Locale.US)
            .filter { it != ' ' && it != '\t' }
        if (norm.isEmpty() || norm.length > 16) return false
        if (norm in AT_ALLOW) return true
        if (norm == "03" || norm == "07" || norm == "0A") return true
        if (norm in MODE09_ALLOW) return true
        if (norm.length == 4 && norm.startsWith("01")) {
            val hex = ('0'..'9') + ('A'..'F')
            return norm[2] in hex && norm[3] in hex
        }
        return false
    }
}
