package com.example.obdapp

import com.github.eltonvs.obd.command.ObdRawResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException

class ObdTelemetryParsingTest {
    @Test
    fun decodesSensorPayloadAfterModeAndPidHeader() {
        assertEquals("93", CoolantTemperatureCommand().handleResponse(ObdRawResponse("41 05 85", 0)).value)
        assertEquals("50", LoadCommand().handleResponse(ObdRawResponse("41 04 80", 0)).value)
        assertEquals("50", ThrottlePositionCommand().handleResponse(ObdRawResponse("41 11 80", 0)).value)
        assertEquals("50", FuelLevelCommand().handleResponse(ObdRawResponse("41 2F 80", 0)).value)
        assertEquals("14.0", ModuleVoltageCommand().handleResponse(ObdRawResponse("41 42 36 B0", 0)).value)
        assertEquals("35", AmbientAirTempCommand().handleResponse(ObdRawResponse("41 46 4B", 0)).value)
    }

    @Test
    fun rejectsTruncatedAndWrongPidFrames() {
        assertThrows(IOException::class.java) { obdPidPayload(ObdRawResponse("41 42 36", 0), 0x42, 2) }
        assertThrows(IOException::class.java) { obdPidPayload(ObdRawResponse("41 11 80", 0), 0x04, 1) }
    }

    @Test
    fun parsesFuelInputsAndRejectsIncompleteOrDifferentReplies() {
        assertEquals("3.24", MassAirFlowCommand().handleResponse(ObdRawResponse("41 10 01 44", 0)).value)
        assertEquals("2", FuelSystemStatusCommand().handleResponse(ObdRawResponse("41 03 02 00", 0)).value)
        val mixedStatus = FuelSystemStatusCommand()
        assertEquals("2", mixedStatus.handleResponse(ObdRawResponse("41 03 02 04", 0)).value)
        assertEquals(4, mixedStatus.secondarySystemStatus)
        assertThrows(IOException::class.java) { MassAirFlowCommand().handleResponse(ObdRawResponse("41 10 01", 0)) }
        assertThrows(IOException::class.java) { MassAirFlowCommand().handleResponse(ObdRawResponse("41 42 01 44", 0)) }
        assertThrows(IOException::class.java) { FuelSystemStatusCommand().handleResponse(ObdRawResponse("41 03 02", 0)) }
    }
}
