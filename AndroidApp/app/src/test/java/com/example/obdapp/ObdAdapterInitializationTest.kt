package com.example.obdapp

import com.github.eltonvs.obd.connection.ObdDeviceConnection
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import com.github.eltonvs.obd.command.engine.RPMCommand

class ObdAdapterInitializationTest {
    @Test
    fun acceptsAdapterBannerAndDiscoversCapabilities() = runBlocking {
        val input = ByteArrayInputStream(
            ("AT Z\rELM327 v1.5\r\n>AT E0\rOK\r\n>OK\r\n>SEARCHING...\r\n" +
            "41 00 BE 3F B8 13\r\n>41 20 80 04 20 01\r\n>41 40 4A DD 00 00\r\n>41 0C 1F 9D\r\n>").toByteArray()
        )
        val output = ByteArrayOutputStream()
        val connection = ObdDeviceConnection(input, output)

        val capabilities = initializeObdAdapter(connection)
        assertEquals("2023", connection.run(RPMCommand()).value)

        assertTrue(capabilities.isSupported(0x0C)) // RPM
        assertTrue(capabilities.isSupported(0x0F)) // Intake Air Temp
        assertTrue(capabilities.isSupported(0x45)) // Relative Throttle
        assertFalse(capabilities.isSupported(0x2F)) // Fuel Level
        assertFalse(capabilities.isSupported(0x46)) // Ambient Air Temp

        assertEquals(
            listOf("AT Z", "AT E0", "AT SP 0", "01 00", "01 20", "01 40", "01 0C"),
            output.toString().trimEnd('\r').split('\r')
        )
    }

    @Test
    fun rejectsProtocolSearchWithoutVehicleData() {
        val input = ByteArrayInputStream("ELM327 v1.5>OK>OK>SEARCHING...>".toByteArray())
        assertThrows(IOException::class.java) {
            runBlocking { initializeObdAdapter(ObdDeviceConnection(input, ByteArrayOutputStream())) }
        }
    }
}
