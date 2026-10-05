package com.example.obdapp.car

import com.example.obdapp.GatewayStatus
import com.example.obdapp.GatewaySyncState
import org.junit.Assert.*
import org.junit.Test

class CarStatusPresenterTest {
    private val sample = GatewayStatus(
        running = true, vehicleId = "car-a", adapterConnected = true, gpsFix = true,
        gpsFixAtElapsedMs = 1_000L, sampledAtElapsedMs = 1_000L,
        syncVehicleId = "car-a", syncState = GatewaySyncState.SYNCED, syncUpdatedAtElapsedMs = 1_000L
    )

    @Test fun currentDeviceStatusIsShown() {
        val view = present(sample, 2_000L)
        assertEquals(AdapterStatus.CONNECTED, view.adapter)
        assertTrue(view.gpsReady)
        assertEquals(GatewaySyncState.SYNCED, view.sync)
    }

    @Test fun staleAndFutureSamplesNeverClaimAConnection() {
        for (now in listOf(999L, 16_001L)) {
            val view = present(sample, now)
            assertEquals(AdapterStatus.WAITING, view.adapter)
            assertFalse(view.gpsReady)
        }
    }

    @Test fun gpsExpiresIndependentlyFromAdapterStatus() {
        val view = present(sample, 11_001L)
        assertEquals(AdapterStatus.CONNECTED, view.adapter)
        assertFalse(view.gpsReady)
    }

    @Test fun vehicleSwitchHidesPreviousVehiclesState() {
        val view = CarStatusPresenter.present(sample, "car-b", true, 2_000L)
        assertEquals(AdapterStatus.WAITING, view.adapter)
        assertFalse(view.gpsReady)
        assertEquals(GatewaySyncState.UNKNOWN, view.sync)
    }

    @Test fun stoppedCollectionAndExpiredSyncAreHonest() {
        assertEquals(AdapterStatus.STOPPED, present(sample.copy(running = false), 2_000L).adapter)
        assertEquals(GatewaySyncState.UNKNOWN, present(sample, 121_001L).sync)
    }

    @Test fun unpairedPhoneRequiresPhoneSetup() {
        val view = CarStatusPresenter.present(sample, "car-a", false, 2_000L)
        assertTrue(view.setupRequired)
        assertEquals(GatewaySyncState.SETUP_REQUIRED, view.sync)
    }

    @Test fun freshLiveGaugesAreFormatted() {
        val sampleWithGauges = sample.copy(
            liveGauges = com.example.obdapp.LiveGaugeSnapshot(
                speedKmh = 64.6f,
                speedSource = "GPS",
                rpm = 2300,
                coolantTemp = 90,
                voltage = 14.2f,
                fuelRateLph = 2.1,
                fuelEconomyKmL = 15.5,
                engineLoad = 45,
                sampledAtElapsedMs = 1_000L
            )
        )
        val gauges = CarStatusPresenter.presentGauges(sampleWithGauges, "car-a", 2_000L)
        assertEquals("65 km/h", gauges.speedValue)
        assertEquals("GPS", gauges.speedSource)
        assertEquals("2300 RPM", gauges.rpmValue)
        assertEquals("90 °C", gauges.coolantValue)
        assertEquals("14.2 V", gauges.voltageValue)
        assertEquals("15.5", gauges.fuelEconomyValue)
        assertEquals("km/L", gauges.fuelEconomyUnit)
        assertEquals("45 %", gauges.loadValue)
    }

    @Test fun idleLiveGaugesShowFuelRatePerHour() {
        val sampleWithGauges = sample.copy(
            liveGauges = com.example.obdapp.LiveGaugeSnapshot(
                speedKmh = 0.0f,
                speedSource = "OBD",
                rpm = 750,
                coolantTemp = 85,
                voltage = 13.8f,
                fuelRateLph = 0.9,
                fuelEconomyKmL = null,
                engineLoad = 20,
                sampledAtElapsedMs = 1_000L
            )
        )
        val gauges = CarStatusPresenter.presentGauges(sampleWithGauges, "car-a", 2_000L)
        assertEquals("0 km/h", gauges.speedValue)
        assertEquals("OBD", gauges.speedSource)
        assertEquals("0.9", gauges.fuelEconomyValue)
        assertEquals("L/h", gauges.fuelEconomyUnit)
    }

    @Test fun staleLiveGaugesShowPlaceholders() {
        val sampleWithGauges = sample.copy(
            liveGauges = com.example.obdapp.LiveGaugeSnapshot(
                speedKmh = 60f,
                rpm = 2000,
                coolantTemp = 90,
                voltage = 14.0f,
                sampledAtElapsedMs = 1_000L
            )
        )
        // 16_001L is past the 15_000L freshness limit
        val gauges = CarStatusPresenter.presentGauges(sampleWithGauges, "car-a", 16_001L)
        assertEquals("--", gauges.speedValue)
        assertEquals("--", gauges.rpmValue)
        assertEquals("--", gauges.coolantValue)
        assertEquals("--", gauges.voltageValue)
        assertEquals("--", gauges.fuelEconomyValue)
        assertEquals("--", gauges.loadValue)
    }

    @Test fun stoppedGatewayOrVehicleMismatchHidesGauges() {
        val sampleWithGauges = sample.copy(
            liveGauges = com.example.obdapp.LiveGaugeSnapshot(
                speedKmh = 60f,
                rpm = 2000,
                sampledAtElapsedMs = 1_000L
            )
        )
        val stoppedGauges = CarStatusPresenter.presentGauges(sampleWithGauges.copy(running = false), "car-a", 2_000L)
        assertEquals("--", stoppedGauges.speedValue)

        val mismatchedGauges = CarStatusPresenter.presentGauges(sampleWithGauges, "car-other", 2_000L)
        assertEquals("--", mismatchedGauges.speedValue)
    }

    private fun present(status: GatewayStatus, now: Long) = CarStatusPresenter.present(status, "car-a", true, now)
}
