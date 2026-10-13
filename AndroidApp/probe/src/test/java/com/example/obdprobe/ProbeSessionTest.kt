package com.example.obdprobe

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ProbeSessionTest {
    private class FakeChannel(private val replies: Map<String, String>) : ProbeChannel {
        val requests = mutableListOf<Pair<String, Long>>()
        override fun transact(command: String, timeoutMs: Long): String {
            requests += command to timeoutMs
            return replies[command] ?: throw IOException("Unexpected command: $command")
        }
        override fun close() = Unit
    }

    @Test fun followsOnlyAdvertisedContinuationAndUnionsEcus() {
        val channel = FakeChannel(mapOf(
            "0100" to "41 00 00 10 00 01\r41 00 00 08 00 00",
            "0120" to "41 20 00 02 00 00", "ATDP" to "CAN", "ATDPN" to "A6"))
        val supported = ProbeSession(channel) {}.discover()
        assertEquals(setOf(0x0C, 0x0D, 0x2F), supported)
        assertEquals(listOf("0100", "0120", "ATDP", "ATDPN"), channel.requests.map { it.first })
        assertEquals(15_000L, channel.requests.first().second)
    }

    @Test fun absentMapDoesNotBlindlyScanAllPidRanges() {
        val channel = FakeChannel(mapOf("0100" to "NO DATA", "ATDP" to "AUTO", "ATDPN" to "A0"))
        assertTrue(ProbeSession(channel) {}.discover().isEmpty())
        assertEquals(listOf("0100", "ATDP", "ATDPN"), channel.requests.map { it.first })
    }

    @Test fun discoveryIsBoundedEvenIfEveryContinuationBitIsSet() {
        val replies = (0..0xE0 step 0x20).associate { base ->
            "01%02X".format(base) to "41 %02X 00 00 00 01".format(base)
        } + mapOf("ATDP" to "CAN", "ATDPN" to "A6")
        val channel = FakeChannel(replies)
        assertTrue(ProbeSession(channel) {}.discover().isEmpty())
        assertEquals(10, channel.requests.size)
        assertFalse(channel.requests.any { it.first == "01100" })
    }

    @Test fun writeCommandsNeverReachTheTransport() {
        val channel = FakeChannel(emptyMap())
        val probe = ProbeSession(channel) {}
        for (command in listOf("04", "08", "22F190", "ATSH7E0", "010C\r04")) {
            try { probe.query(command); fail("Must reject $command") } catch (_: IllegalArgumentException) { }
        }
        assertTrue(channel.requests.isEmpty())
    }

    @Test fun readingPreservesDistinctEcuValuesRatherThanInventingAnAverage() {
        val channel = FakeChannel(mapOf("010C" to "41 0C 1A F8\r41 0C 0F A0"))
        assertEquals("1726 rpm | 1000 rpm", ProbeSession(channel) {}.read(0x0C))
    }

    @Test fun failedRequestsRemainInTheReportAndStopTheScan() {
        val channel = FakeChannel(emptyMap())
        val report = mutableListOf<ProbeExchange>()
        try { ProbeSession(channel) { report += it }.discover(); fail("Expected failure") } catch (_: IOException) { }
        assertEquals(1, channel.requests.size)
        assertEquals("0100", report.single().command)
        assertTrue(report.single().response.startsWith("ERROR:"))
    }
}
