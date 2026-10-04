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
}
