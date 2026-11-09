package com.example.obdapp

import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class GatewayStatusStoreTest {
    @Test fun vehicleSwitchWithoutANewSnapshotCannotRelabelAnotherVehiclesGauges() {
        GatewayStatusStore.recordSample("first", true, null, 1000L,
            LiveGaugeSnapshot(speedKmh = 80f, sampledAtElapsedMs = 1000L, tripEconomyKmL = 18.2))
        GatewayStatusStore.recordSample("second", true, null, 1100L)
        assertEquals("second", GatewayStatusStore.status.value.vehicleId)
        assertNull(GatewayStatusStore.status.value.liveGauges)
        GatewayStatusStore.setRunning(false)
    }
    @After fun clear() { GatewayStatusStore.setRunning(false) }

    @Test fun newlyRecordedDataIsQueuedAfterSuccessfulUpload() {
        GatewayStatusStore.recordSync("a", GatewaySyncState.SYNCED, 100L)
        GatewayStatusStore.recordSample("a", true, 100L, 101L)
        assertEquals(GatewaySyncState.QUEUED, GatewayStatusStore.status.value.syncState)
    }

    @Test fun stopClearsPreviousConnectionsAndFixes() {
        GatewayStatusStore.recordSample("a", true, 100L, 101L)
        GatewayStatusStore.setRunning(false)
        assertEquals(GatewayStatus(), GatewayStatusStore.status.value)
    }

    @Test fun recordingDuringUploadDoesNotOverrideItsState() {
        GatewayStatusStore.recordSync("a", GatewaySyncState.UPLOADING, 100L)
        GatewayStatusStore.recordSample("a", false, null, 101L)
        assertEquals(GatewaySyncState.UPLOADING, GatewayStatusStore.status.value.syncState)
        assertFalse(GatewayStatusStore.status.value.gpsFix)
    }

    @Test fun independentSpeedTimestampsAndTripMetadataPreservedOnPublication() {
        val snapshot = LiveGaugeSnapshot(
            speedKmh = 75f,
            speedSource = "OBD",
            rpm = 2500,
            coolantTemp = 88,
            voltage = 13.8f,
            fuelRateLph = 4.2,
            fuelEconomyKmL = 17.8,
            engineLoad = 35,
            throttlePos = 18,
            intakeAirTemp = 28,
            manifoldPressureKpa = 98,
            sampledAtElapsedMs = 20_000L,
            obdSpeedKmh = 75.0f,
            obdSpeedAtElapsedMs = 19_950L,
            gpsSpeedKmh = 74.2f,
            gpsSpeedAtElapsedMs = 19_200L,
            tripEconomyKmL = 16.4,
            tripCoverageRatio = 0.95,
            tripSampledAtElapsedMs = 19_980L
        )

        GatewayStatusStore.recordSample(
            vehicleId = "car-alpha",
            adapterConnected = true,
            gpsFixAtElapsedMs = 19_200L,
            elapsedMs = 20_000L,
            liveGauges = snapshot
        )

        val status = GatewayStatusStore.status.value
        assertTrue(status.running)
        assertEquals("car-alpha", status.vehicleId)
        assertTrue(status.adapterConnected)
        assertTrue(status.gpsFix)
        assertEquals(19_200L, status.gpsFixAtElapsedMs)
        assertEquals(20_000L, status.sampledAtElapsedMs)

        val recordedGauges = status.liveGauges
        assertNotNull(recordedGauges)
        assertEquals(75.0f, recordedGauges?.obdSpeedKmh)
        assertEquals(19_950L, recordedGauges?.obdSpeedAtElapsedMs)
        assertEquals(74.2f, recordedGauges?.gpsSpeedKmh)
        assertEquals(19_200L, recordedGauges?.gpsSpeedAtElapsedMs)
        assertEquals(16.4, recordedGauges?.tripEconomyKmL)
        assertEquals(0.95, recordedGauges?.tripCoverageRatio)
        assertEquals(19_980L, recordedGauges?.tripSampledAtElapsedMs)
    }

    @Test fun stoppingServiceClearsLiveGaugesAndExtendedMetadata() {
        val snapshot = LiveGaugeSnapshot(
            speedKmh = 50f,
            speedSource = "GPS",
            sampledAtElapsedMs = 10_000L,
            obdSpeedKmh = null,
            obdSpeedAtElapsedMs = null,
            gpsSpeedKmh = 50.0f,
            gpsSpeedAtElapsedMs = 9_800L,
            tripEconomyKmL = 12.0,
            tripCoverageRatio = 0.85,
            tripSampledAtElapsedMs = 9_900L
        )
        GatewayStatusStore.recordSample(
            vehicleId = "car-beta",
            adapterConnected = false,
            gpsFixAtElapsedMs = 9_800L,
            elapsedMs = 10_000L,
            liveGauges = snapshot
        )
        assertNotNull(GatewayStatusStore.status.value.liveGauges)

        GatewayStatusStore.setRunning(false)

        val status = GatewayStatusStore.status.value
        assertFalse(status.running)
        assertNull(status.vehicleId)
        assertNull(status.liveGauges)
        assertEquals(GatewayStatus(), status)
    }

    @Test fun subsequentSampleWithoutLiveGaugesRetainsExtendedMetadataUntilStopped() {
        val snapshot = LiveGaugeSnapshot(
            speedKmh = 30f,
            sampledAtElapsedMs = 1_000L,
            obdSpeedKmh = 30.0f,
            obdSpeedAtElapsedMs = 950L,
            gpsSpeedKmh = null,
            gpsSpeedAtElapsedMs = null,
            tripEconomyKmL = 15.0,
            tripCoverageRatio = 1.0,
            tripSampledAtElapsedMs = 980L
        )
        GatewayStatusStore.recordSample("car-gamma", true, null, 1_000L, snapshot)
        assertEquals(30.0f, GatewayStatusStore.status.value.liveGauges?.obdSpeedKmh)

        GatewayStatusStore.recordSample("car-gamma", true, null, 2_000L, liveGauges = null)
        assertEquals(30.0f, GatewayStatusStore.status.value.liveGauges?.obdSpeedKmh)
        assertEquals(950L, GatewayStatusStore.status.value.liveGauges?.obdSpeedAtElapsedMs)
        assertEquals(15.0, GatewayStatusStore.status.value.liveGauges?.tripEconomyKmL)

        GatewayStatusStore.setRunning(false)
        assertNull(GatewayStatusStore.status.value.liveGauges)
    }
}
