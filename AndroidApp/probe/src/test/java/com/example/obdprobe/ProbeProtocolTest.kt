package com.example.obdprobe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProbeProtocolTest {
    @Test fun dataContainingResponseHeaderCannotInventAnotherService() {
        assertTrue(ProbeProtocol.payloads("49 02 01 41 0C 1A F8", 0x41, 0x0C).isEmpty())
        assertTrue(ProbeProtocol.supportedPids("7F 01 11 41 00 80 00 00 01").isEmpty())
    }

    @Test fun malformedTokensCannotBeDiscardedToCreateAValidFrame() {
        assertTrue(ProbeProtocol.supportedPids("41 00 80 BAD 00 00 01").isEmpty())
        assertTrue(ProbeProtocol.payloads("41 0C 1A XX F8", 0x41, 0x0C).isEmpty())
    }

    @Test fun unknownPayloadContaining41IsPreserved() {
        assertEquals(listOf(listOf(0x12, 0x41, 0x34)), ProbeProtocol.payloads("41 99 12 41 34", 0x41, 0x99))
    }

    @Test fun extraTrailingResponseByteCannotValidateAMask() {
        assertTrue(ProbeProtocol.supportedPids("41 00 80 00 00 01 41").isEmpty())
    }

    // ---------- supportedPids ----------

    @Test
    fun supportedPids_spacedSingleEcu() {
        val pids = ProbeProtocol.supportedPids("41 00 BE 3E B8 11", mode = 1, base = 0)
        assertEquals(17, pids.size)
        assertTrue(pids.containsAll(listOf(0x01, 0x04, 0x0C, 0x11, 0x1C, 0x20)))
        assertFalse(pids.contains(0x02))
        assertFalse(pids.contains(0x08))
        assertFalse(pids.contains(0x10))
        assertFalse(pids.contains(0x1F))
    }

    @Test
    fun supportedPids_compactFrame() {
        val spaced = ProbeProtocol.supportedPids("41 00 BE 3E B8 11")
        val compact = ProbeProtocol.supportedPids("4100BE3EB811")
        assertEquals(spaced, compact)
    }

    @Test
    fun supportedPids_multipleEcuUnion() {
        val single = ProbeProtocol.supportedPids("41 00 BE 3E B8 11\r")
        assertFalse(single.contains(0x1F))
        val union = ProbeProtocol.supportedPids(
            "41 00 BE 3E B8 11\r41 00 00 00 00 02\r>"
        )
        assertTrue(union.containsAll(single))
        assertTrue(union.contains(0x1F))
    }

    @Test
    fun supportedPids_compactMultipleEcuSingleLine() {
        val union = ProbeProtocol.supportedPids("4100BE3EB811410000000002")
        assertTrue(union.contains(0x01))
        assertTrue(union.contains(0x1F))
    }

    @Test
    fun supportedPids_searchingEchoPromptNoise() {
        val clean = ProbeProtocol.supportedPids("41 00 BE 3E B8 11")
        assertEquals(
            clean,
            ProbeProtocol.supportedPids("SEARCHING...\r0100\r41 00 BE 3E B8 11\r>")
        )
        assertEquals(clean, ProbeProtocol.supportedPids("SEARCHING...4100BE3EB811\r>"))
    }

    @Test
    fun supportedPids_negativeAndErrorTextIgnored() {
        assertTrue(ProbeProtocol.supportedPids("7F 01 11").isEmpty())
        assertTrue(ProbeProtocol.supportedPids("7F 01 12\rNO DATA").isEmpty())
        assertTrue(ProbeProtocol.supportedPids("NO DATA").isEmpty())
        assertTrue(ProbeProtocol.supportedPids("?").isEmpty())
        assertTrue(ProbeProtocol.supportedPids("STOPPED").isEmpty())
        assertTrue(ProbeProtocol.supportedPids("UNABLE TO CONNECT").isEmpty())
        assertTrue(ProbeProtocol.supportedPids("").isEmpty())
    }

    @Test
    fun supportedPids_malformedMasksRejected() {
        // Truncated: only 2 and 3 data bytes.
        assertTrue(ProbeProtocol.supportedPids("41 00 BE 3E").isEmpty())
        assertTrue(ProbeProtocol.supportedPids("41 00 BE 3E B8").isEmpty())
        // Over-long: 5 data bytes violates the exactly-4-bytes rule.
        assertTrue(ProbeProtocol.supportedPids("41 00 BE 3E B8 11 22").isEmpty())
        // Odd-length compact token is not valid hex framing.
        assertTrue(ProbeProtocol.supportedPids("4100BE3EB8112").isEmpty())
    }

    @Test
    fun supportedPids_wrongPidOrModeIgnored() {
        // Mask for base 0x20 must not count toward base 0x00.
        assertTrue(ProbeProtocol.supportedPids("41 20 80 00 00 01", base = 0x00).isEmpty())
        // ...but counts for its own base (MSB -> 0x21, LSB -> 0x40).
        val pids = ProbeProtocol.supportedPids("41 20 80 00 00 01", base = 0x20)
        assertTrue(pids.contains(0x21))
        assertTrue(pids.contains(0x40))
    }

    @Test
    fun supportedPids_vinMultilineNotFalselyDecoded() {
        val vin = "0: 49 02 01 00 00 00 41\r" +
            "1: 31 48 47 43 4D 38 32\r" +
            "2: 35 33 34 35 36 37 38\r>"
        assertTrue(ProbeProtocol.supportedPids(vin, mode = 1, base = 0).isEmpty())
        assertTrue(ProbeProtocol.payloads(vin, 0x41, 0x02).isEmpty())
        // Tolerated raw: 09/02 lookup itself must not throw.
        ProbeProtocol.payloads(vin, 0x49, 0x02)
    }

    @Test
    fun supportedPids_largeInputBounded() {
        val big = "41 00 BE 3E B8 11\r".repeat(500)
        val pids = ProbeProtocol.supportedPids(big)
        assertEquals(ProbeProtocol.supportedPids("41 00 BE 3E B8 11"), pids)
    }

    // ---------- payloads ----------

    @Test
    fun payloads_singleFrame() {
        assertEquals(
            listOf(listOf(0x1A, 0xF8)),
            ProbeProtocol.payloads("41 0C 1A F8", 0x41, 0x0C)
        )
    }

    @Test
    fun payloads_compactAndSpacedEquivalent() {
        assertEquals(
            ProbeProtocol.payloads("41 0C 1A F8", 0x41, 0x0C),
            ProbeProtocol.payloads("410C1AF8", 0x41, 0x0C)
        )
    }

    @Test
    fun payloads_multipleEcuReplies() {
        val out = ProbeProtocol.payloads("41 0C 1A F8\r41 0C 1B 00\r>", 0x41, 0x0C)
        assertEquals(2, out.size)
        assertEquals(listOf(0x1A, 0xF8), out[0])
        assertEquals(listOf(0x1B, 0x00), out[1])
    }

    @Test
    fun payloads_wrongPidModeOrNegativeIgnored() {
        assertTrue(ProbeProtocol.payloads("41 0D 28", 0x41, 0x0C).isEmpty())
        assertTrue(ProbeProtocol.payloads("7F 01 11", 0x41, 0x01).isEmpty())
        assertTrue(ProbeProtocol.payloads("NO DATA", 0x41, 0x0C).isEmpty())
        assertTrue(ProbeProtocol.payloads("41 0C 1A F8", 0x41, 0x0D).isEmpty())
    }

    @Test
    fun payloads_truncatedFrameDropped() {
        // RPM needs 2 bytes; only 1 present.
        assertTrue(ProbeProtocol.payloads("41 0C 1A", 0x41, 0x0C).isEmpty())
        // Header with no data at all.
        assertTrue(ProbeProtocol.payloads("41 0C", 0x41, 0x0C).isEmpty())
    }

    @Test
    fun payloads_echoAndSearchingTolerated() {
        val out = ProbeProtocol.payloads("SEARCHING...\r010C\r41 0C 1A F8\r>", 0x41, 0x0C)
        assertEquals(listOf(listOf(0x1A, 0xF8)), out)
    }

    @Test
    fun payloads_outputBounded() {
        val many = "41 0C 1A F8\r".repeat(100)
        val out = ProbeProtocol.payloads(many, 0x41, 0x0C)
        assertTrue(out.size in 2..16)
    }

    // ---------- decode / label ----------

    @Test
    fun decode_formulas() {
        assertEquals("1726 rpm", ProbeProtocol.decode(0x0C, listOf(0x1A, 0xF8)))
        assertEquals("40 km/h", ProbeProtocol.decode(0x0D, listOf(0x28)))
        assertEquals("49.8 %", ProbeProtocol.decode(0x11, listOf(0x7F)))
        assertEquals("100 %", ProbeProtocol.decode(0x04, listOf(0xFF)))
        assertEquals("50 C", ProbeProtocol.decode(0x05, listOf(0x5A)))
        assertEquals("25 C", ProbeProtocol.decode(0x0F, listOf(0x41)))
        assertEquals("100 %", ProbeProtocol.decode(0x2F, listOf(0xFF)))
        assertEquals("12.6 V", ProbeProtocol.decode(0x42, listOf(0x31, 0x38)))
        assertEquals("2.56 g/s", ProbeProtocol.decode(0x10, listOf(0x01, 0x00)))
        assertEquals("123 s", ProbeProtocol.decode(0x1F, listOf(0x00, 0x7B)))
        assertEquals("-40 C", ProbeProtocol.decode(0x46, listOf(0x00)))
        assertEquals("90 C", ProbeProtocol.decode(0x5C, listOf(0x82)))
    }

    @Test
    fun decode_unknownPidYieldsRawHex() {
        assertEquals("AA BB", ProbeProtocol.decode(0x99, listOf(0xAA, 0xBB)))
        assertEquals("PID 99", ProbeProtocol.label(0x99))
    }

    @Test
    fun decode_truncatedKnownPidYieldsRawHex() {
        assertEquals("1A", ProbeProtocol.decode(0x0C, listOf(0x1A)))
        assertEquals("", ProbeProtocol.decode(0x0C, emptyList()))
    }

    @Test
    fun label_knownSensors() {
        assertEquals("Engine RPM", ProbeProtocol.label(0x0C))
        assertEquals("Vehicle Speed", ProbeProtocol.label(0x0D))
        assertEquals("Throttle Position", ProbeProtocol.label(0x11))
        assertEquals("Engine Load", ProbeProtocol.label(0x04))
        assertEquals("Coolant Temperature", ProbeProtocol.label(0x05))
        assertEquals("Fuel Level", ProbeProtocol.label(0x2F))
        assertEquals("Control Module Voltage", ProbeProtocol.label(0x42))
        assertEquals("Engine Oil Temperature", ProbeProtocol.label(0x5C))
    }

    // ---------- allowed ----------

    @Test
    fun allowed_initAndStatusCommands() {
        for (cmd in listOf(
            "ATZ", "ATE0", "ATL0", "ATH0", "ATS1", "ATCAF1", "ATSP0",
            "ATI", "ATDP", "ATDPN", "ATRV", "atz", "ati"
        )) {
            assertTrue(cmd, ProbeProtocol.allowed(cmd))
        }
    }

    @Test
    fun allowed_mode01And09AndDtcModes() {
        for (cmd in listOf("0100", "010C", "01 0c", "012F", "0900", "0902", "0904", "0906", "090A", "03", "07", "0A")) {
            assertTrue(cmd, ProbeProtocol.allowed(cmd))
        }
    }

    @Test
    fun allowed_rejectsWriteUdsAndRawCan() {
        for (cmd in listOf(
            "04", "08", "0800", "0901", "03FF", "22F190", "19 02", "2F01",
            "ATSH7E0", "ATCRA7E8", "ATMA", "ATE1", "ATH1", "ATCAF0", "ATSP6",
            "ATWS", "ATD", "010", "010C00", "01", "", "090B"
        )) {
            assertFalse(cmd, ProbeProtocol.allowed(cmd))
        }
    }

    @Test
    fun allowed_rejectsInjection() {
        assertFalse(ProbeProtocol.allowed("010C\r"))
        assertFalse(ProbeProtocol.allowed("010C\n"))
        assertFalse(ProbeProtocol.allowed("010C;010D"))
        assertFalse(ProbeProtocol.allowed("ATZ\r03"))
        assertFalse(ProbeProtocol.allowed("01 0C\n41 0C"))
    }
}
