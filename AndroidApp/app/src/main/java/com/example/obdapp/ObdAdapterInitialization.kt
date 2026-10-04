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

internal suspend fun initializeObdAdapter(connection: ObdDeviceConnection) {
    // AT commands accept adapter banners and OK replies rather than PID data.
    connection.run(ResetAdapterCommand())
    delay(500)
    connection.run(SetEchoCommand(Switcher.OFF))
    connection.run(SelectProtocolCommand(ObdProtocols.AUTO))
    connection.run(ProtocolProbeCommand())
}
