package com.example.obdapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DtcReadDisplayTest {

    @Test
    fun codesExtractsValidStandardAndHexCodes() {
        val raw = "p012a, P0420   B1234 C0300, u1900 P042F"
        val codes = DtcReadDisplay.codes(raw)
        assertEquals(listOf("P012A", "P0420", "B1234", "C0300", "U1900", "P042F"), codes)
    }

    @Test
    fun codesFiltersOutInvalidCodesAndDuplicates() {
        val raw = "P012A, INVALID, P9999, P012, E0101, P042G, P012A"
        val codes = DtcReadDisplay.codes(raw)
        assertEquals(listOf("P012A"), codes)
    }

    @Test
    fun resolveReturnsUnknownWhenNeverPolled() {
        val result = DtcReadDisplay.resolve("", null, null)
        assertEquals(DtcReadDisplay.State.UNKNOWN, result.state)
        assertTrue(result.codes.isEmpty())
        assertNull(result.timestamp)
        assertNull(result.error)
        assertFalse(result.historical)

        val resultZero = DtcReadDisplay.resolve("", 0L, DtcReadDisplay.ReadStatus(null, 0L))
        assertEquals(DtcReadDisplay.State.UNKNOWN, resultZero.state)
        assertTrue(resultZero.codes.isEmpty())
    }

    @Test
    fun resolveReturnsEmptyOnConfirmedCleanScan() {
        for (emptyText in listOf("", "No trouble codes found", "No DTCs", "no dtcs", "NO TROUBLE CODES FOUND")) {
            val result = DtcReadDisplay.resolve(emptyText, 1700000000000L, DtcReadDisplay.ReadStatus(true, 1700000000000L))
            assertEquals(DtcReadDisplay.State.EMPTY, result.state)
            assertTrue(result.codes.isEmpty())
            assertEquals(1700000000000L, result.timestamp)
            assertNull(result.error)
            assertFalse(result.historical)
        }
    }

    @Test
    fun resolveReturnsCodesOnConfirmedActiveFaults() {
        val result = DtcReadDisplay.resolve("P012A, P0420", 1700000000000L, DtcReadDisplay.ReadStatus(true, 1700000000000L))
        assertEquals(DtcReadDisplay.State.CODES, result.state)
        assertEquals(listOf("P012A", "P0420"), result.codes)
        assertEquals(1700000000000L, result.timestamp)
        assertNull(result.error)
        assertFalse(result.historical)
    }

    @Test
    fun resolveMarksFailedScanWithoutHistoryWhenNoPriorConfirmedScan() {
        val result = DtcReadDisplay.resolve("", null, DtcReadDisplay.ReadStatus(false, 1700000005000L, "ECU timeout"))
        assertEquals(DtcReadDisplay.State.FAILED, result.state)
        assertTrue(result.codes.isEmpty())
        assertEquals(1700000005000L, result.timestamp)
        assertEquals("ECU timeout", result.error)
        assertFalse(result.historical)
    }

    @Test
    fun resolveMarksFailedScanWithHistoricalCodesWhenPriorConfirmedScanExists() {
        // Prior scan confirmed P012A at t=1000, latest attempt failed at t=2000
        val result = DtcReadDisplay.resolve(
            raw = "P012A",
            dtcTimestamp = 1700000001000L,
            read = DtcReadDisplay.ReadStatus(false, 1700000002000L, "Adapter disconnected")
        )
        assertEquals(DtcReadDisplay.State.FAILED, result.state)
        assertEquals(listOf("P012A"), result.codes)
        assertEquals(1700000002000L, result.timestamp)
        assertEquals("Adapter disconnected", result.error)
        assertTrue(result.historical)
    }

    @Test
    fun resolveMarksFailedWhenRawResponseContainsInvalidText() {
        val result = DtcReadDisplay.resolve("UNRECOGNIZED PROTOCOL ERROR", 1700000001000L, null)
        assertEquals(DtcReadDisplay.State.FAILED, result.state)
        assertTrue(result.codes.isEmpty())
        assertEquals("UNRECOGNIZED PROTOCOL ERROR", result.error)
        assertFalse(result.historical)
    }
}
