package com.example.obdapp

import com.github.eltonvs.obd.command.ObdProtocols
import com.github.eltonvs.obd.command.ObdCommand
import com.github.eltonvs.obd.command.ObdRawResponse
import com.github.eltonvs.obd.command.Switcher
import com.github.eltonvs.obd.command.at.ResetAdapterCommand
import com.github.eltonvs.obd.command.at.SelectProtocolCommand
import com.github.eltonvs.obd.command.at.SetEchoCommand
import com.github.eltonvs.obd.connection.ObdDeviceConnection
import kotlinx.coroutines.delay
import java.io.IOException

private class ProtocolProbeCommand : ObdCommand() {
    override val tag = "PROTOCOL_PROBE"
    override val name = "Discover vehicle protocol"
    override val mode = "01"
    override val pid = "00"
    // AUTO protocol discovery can prefix the first reply with SEARCHING...
    // Validate the supported-PID frame explicitly instead of accepting text
    // as a sensor value or passing the prefix to the library's numeric parser.
    override val skipDigitCheck = true
    override val handler = { response: ObdRawResponse ->
        Regex("41\\s*00(?:\\s*[0-9A-F]{2}){4}(?![0-9A-F])", RegexOption.IGNORE_CASE)
            .find(response.value)?.value
            ?: throw IOException("Vehicle protocol discovery returned no supported-PID frame")
    }
}

private class PidSupportMaskCommand(override val pid: String) : ObdCommand() {
    override val tag = "PID_SUPPORT_MASK_$pid"
    override val name = "Discover supported PIDs $pid"
    override val mode = "01"
    override val skipDigitCheck = true
    override val handler = { response: ObdRawResponse ->
        Regex("41\\s*${pid}(?:\\s*[0-9A-F]{2}){4}(?![0-9A-F])", RegexOption.IGNORE_CASE)
            .find(response.value)?.value
            ?: throw IOException("PID mask $pid returned no supported-PID frame: ${response.value}")
    }
}

internal suspend fun initializeObdAdapter(connection: ObdDeviceConnection): ObdCapabilities {
    // AT commands accept adapter banners and OK replies rather than PID data.
    connection.run(ResetAdapterCommand())
    delay(500)
    connection.run(SetEchoCommand(Switcher.OFF))
    connection.run(SelectProtocolCommand(ObdProtocols.AUTO))
    val probeResp = connection.run(ProtocolProbeCommand()).value
    val allSupportedPids = mutableSetOf<Int>()
    allSupportedPids.addAll(ObdCapabilities.parseMask(probeResp))

    // If PID 0x20 is advertised, query 01 20 (PIDs 0x21 - 0x40)
    if (allSupportedPids.contains(0x20)) {
        try {
            val resp20 = connection.run(PidSupportMaskCommand("20")).value
            allSupportedPids.addAll(ObdCapabilities.parseMask(resp20))
            // If PID 0x40 is advertised, query 01 40 (PIDs 0x41 - 0x60)
            if (allSupportedPids.contains(0x40)) {
                val resp40 = connection.run(PidSupportMaskCommand("40")).value
                allSupportedPids.addAll(ObdCapabilities.parseMask(resp40))
            }
        } catch (_: Exception) {
            // Extended PID masks are non-critical: continue with available capabilities
        }
    }

    return ObdCapabilities(allSupportedPids)
}
