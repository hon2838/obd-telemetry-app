package com.example.obdapp

import com.github.eltonvs.obd.command.NoDataException
import com.github.eltonvs.obd.command.engine.RPMCommand
import com.github.eltonvs.obd.command.engine.SpeedCommand
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentLinkedQueue

class PromptObdConnectionTest {
    @Test
    fun sensorReadsUseLearnedReplyCountButDiagnosticActionsDoNot() = runBlocking {
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(
            ByteArrayInputStream("41 0C 1F 9D>41 0C 1F 9D>44>".toByteArray()), output
        )
        connection.configureResponseCount("A6")
        assertEquals("2023", connection.run(RPMCommand()).value)
        assertEquals("2023", connection.run(RPMCommand()).value)
        val diagnostic = ResetTroubleCodesCommand()
        connection.run(diagnostic)
        assertEquals("01 0C\r01 0C 1\r${diagnostic.rawCommand}\r", output.toString())
    }

    @Test
    fun unknownProtocolsKeepOrdinaryReads() = runBlocking {
        for (protocol in listOf("0", "A0", "AA", "AUTO", "?", "A6garbage")) {
            val output = ByteArrayOutputStream()
            val connection = PromptObdConnection(ByteArrayInputStream("41 0D 28>41 0D 28>".toByteArray()), output)
            connection.configureResponseCount(protocol)
            assertEquals("40", connection.run(SpeedCommand()).value)
            assertEquals("40", connection.run(SpeedCommand()).value)
            assertEquals("01 0D\r01 0D\r", output.toString())
        }
    }

    @Test
    fun legacyAndCanProtocolsBothLearnTheirActualReplyCounts() = runBlocking {
        for (protocol in listOf("1", "A2", "3", "A4", "5", "A6", "7", "A8", "9")) {
            val output = ByteArrayOutputStream()
            val connection = PromptObdConnection(ByteArrayInputStream("41 0D 28>41 0D 28>".toByteArray()), output)
            connection.configureResponseCount(protocol)
            connection.run(SpeedCommand())
            connection.run(SpeedCommand())
            assertEquals("01 0D\r01 0D 1\r", output.toString())
        }
    }

    @Test
    fun rejectedResponseCountFallsBackOnceAndRemainsDisabled() = runBlocking {
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(
            ByteArrayInputStream("41 0C 1F 9D>?>41 0C 1F 9D>41 0D 28>".toByteArray()), output
        )
        connection.configureResponseCount("6")
        assertEquals("2023", connection.run(RPMCommand()).value)
        assertEquals("2023", connection.run(RPMCommand()).value)
        assertEquals("40", connection.run(SpeedCommand()).value)
        assertEquals("01 0C\r01 0C 1\r01 0C\r01 0D\r", output.toString())
    }

    @Test
    fun learnsAllEcuResponsesInsteadOfAssumingOnlyOne() = runBlocking {
        val frame = "41 0C 1F 9D\r41 0C 1F 9D>"
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(ByteArrayInputStream((frame + frame).toByteArray()), output)
        connection.configureResponseCount("A6")
        connection.run(RPMCommand())
        connection.run(RPMCommand())
        assertEquals("01 0C\r01 0C 2\r", output.toString())
    }

    @Test
    fun readsFragmentedReplyUntilPromptThenKeepsNextTransactionSeparate() = runBlocking {
        val bytes = ByteArrayInputStream("41 0C 1F 9D>41 0D 28>".toByteArray())
        val intermittent = object : InputStream() {
            private var ready = false
            override fun available(): Int {
                ready = !ready
                return if (ready) 0 else bytes.available()
            }
            override fun read(): Int = bytes.read()
        }
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(intermittent, output)
        assertEquals("2023", connection.run(RPMCommand()).value)
        assertEquals("40", connection.run(SpeedCommand()).value)
        assertEquals("01 0C\r01 0D\r", output.toString())
    }

    @Test
    fun serializesConcurrentCommands() = runBlocking {
        val replies = ConcurrentLinkedQueue<Int>()
        val input = object : InputStream() {
            override fun available(): Int = replies.size
            override fun read(): Int = replies.poll() ?: -1
        }
        val output = object : OutputStream() {
            private val command = StringBuilder()
            @Synchronized
            override fun write(value: Int) {
                if (value == '\r'.code) {
                    val reply = when (command.toString()) {
                        "01 0C" -> "41 0C 1F 9D>"
                        "01 0D" -> "41 0D 28>"
                        else -> throw IOException("Interleaved command bytes")
                    }
                    command.setLength(0)
                    reply.forEach { replies.add(it.code) }
                } else command.append(value.toChar())
            }
        }
        val connection = PromptObdConnection(input, output)
        val jobs = (0 until 20).map { i ->
            async { connection.run(if (i % 2 == 0) RPMCommand() else SpeedCommand()).value }
        }
        jobs.forEachIndexed { i, result -> assertEquals(if (i % 2 == 0) "2023" else "40", result.await()) }
    }

    @Test
    fun incompleteFrameTimesOutAndCannotBeUsedByNextCommand() {
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(ByteArrayInputStream("41 0C 1F".toByteArray()), output, 30)
        assertThrows(IOException::class.java) { runBlocking { connection.run(RPMCommand()) } }
        assertThrows(IOException::class.java) { runBlocking { connection.run(SpeedCommand()) } }
        assertEquals("01 0C\r", output.toString())
    }

    @Test
    fun completeNoDataReplyDoesNotPoisonConnection() = runBlocking {
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(ByteArrayInputStream("NO DATA>41 0D 28>".toByteArray()), output)
        assertThrows(NoDataException::class.java) { runBlocking { connection.run(RPMCommand()) } }
        assertEquals("40", connection.run(SpeedCommand()).value)
    }

    @Test
    fun cancellationInvalidatesPartialFrameWithoutWritingAnotherCommand() = runBlocking {
        val output = ByteArrayOutputStream()
        val connection = PromptObdConnection(ByteArrayInputStream(byteArrayOf()), output)
        val job = launch { connection.run(RPMCommand()) }
        while (output.size() == 0) delay(5)
        job.cancelAndJoin()
        assertThrows(IOException::class.java) { runBlocking { connection.run(SpeedCommand()) } }
        assertEquals("01 0C\r", output.toString())
    }

    @Test
    fun rejectsOversizedUnterminatedFrames() {
        val connection = PromptObdConnection(
            ByteArrayInputStream("A".repeat(16_385).toByteArray()), ByteArrayOutputStream()
        )
        val failure = assertThrows(IOException::class.java) { runBlocking { connection.run(RPMCommand()) } }
        assertTrue(failure.message!!.contains("frame limit"))
    }
}
