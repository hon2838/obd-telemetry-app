package com.example.obdapp

import com.github.eltonvs.obd.command.ObdRawResponse
import com.github.eltonvs.obd.command.engine.RPMCommand
import com.github.eltonvs.obd.command.engine.SpeedCommand
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException

class ObdBatchReplyTest {
    @Test
    fun decodesShortCombinedResponseUsingExistingSensorHandlers() {
        val frames = ObdBatchReply.decode(ObdRawResponse("41 0C 1F 9D 0D 28", 25), listOf("0C", "0D"))
        assertEquals("2023", RPMCommand().handleResponse(frames.getValue("0C")).value)
        assertEquals("40", SpeedCommand().handleResponse(frames.getValue("0D")).value)
    }

    @Test
    fun decodesDocumentedElmMultilineResponseAndRemovesCanPadding() {
        val raw = "00A\r0: 41 04 3F 05 44 0B\r1: 21 0C 17 B8 00 00 00"
        val frames = ObdBatchReply.decode(ObdRawResponse(raw, 50), listOf("04", "05", "0B", "0C"))
        assertEquals("1518", RPMCommand().handleResponse(frames.getValue("0C")).value)
        assertEquals("28", CoolantTemperatureCommand().handleResponse(frames.getValue("05")).value)
        assertEquals("33", ManifoldAbsolutePressureCommand().handleResponse(frames.getValue("0B")).value)
        assertEquals(50L, frames.getValue("0C").elapsedTime)
    }

    @Test
    fun fuelStatusRetainsBothBanksForFreshnessAndMixtureChecks() {
        val frames = ObdBatchReply.decode(ObdRawResponse("41 03 02 04 10 01 44", 20), listOf("03", "10"))
        val command = FuelSystemStatusCommand()
        assertEquals("2", command.handleResponse(frames.getValue("03")).value)
        assertEquals(4, command.secondarySystemStatus)
    }

    @Test
    fun rejectsTruncationDuplicatePidsWrongModeAndMixedEcuMessages() {
        val malformed = listOf(
            "41 0C 1F", "42 0C 1F 9D 0D 28", "41 0C 1F 9D 0C 1F 9D",
            "41 0C 1F 9D\r41 0D 28", "41 0C 1F 9D 0D 28 ZZ",
            "00D\r0: 41 0C 1F 9D 0D 28\r1: 00",
            "008\r0: 41 0C 1F 9D 0D 28\r2: 00 00"
        )
        malformed.forEach { raw ->
            assertThrows(IOException::class.java) {
                ObdBatchReply.decode(ObdRawResponse(raw, 0), listOf("0C", "0D"))
            }
        }
    }

    @Test
    fun canConnectionSendsOneRequestForMultipleSensors() = runBlocking {
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(ByteArrayInputStream("41 0C 1F 9D 0D 28>".toByteArray()), output)
        connection.configureResponseCount("A6")
        val reply = connection.runBatch(listOf(RPMCommand(), SpeedCommand()))!!
        assertEquals("40", SpeedCommand().handleResponse(reply.getValue("0D")).value)
        assertEquals("01 0C 0D\r", output.toString())
    }

    @Test
    fun partialBatchDisablesGroupingWithoutConsumingNextOrdinaryReply() = runBlocking {
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(ByteArrayInputStream("41 0C 1F 9D>41 0D 28>".toByteArray()), output)
        connection.configureResponseCount("A6")
        val commands = listOf(RPMCommand(), SpeedCommand())
        assertNull(connection.runBatch(commands))
        assertNull(connection.runBatch(commands))
        assertEquals("40", connection.run(SpeedCommand()).value)
        assertEquals("01 0C 0D\r01 0D\r", output.toString())
    }

    @Test
    fun nonCanConnectionDoesNotSendGroupedRequests() = runBlocking {
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(ByteArrayInputStream(byteArrayOf()), output)
        connection.configureResponseCount("A5")
        assertNull(connection.runBatch(listOf(RPMCommand(), SpeedCommand())))
        assertEquals(0, output.size())
    }
}
