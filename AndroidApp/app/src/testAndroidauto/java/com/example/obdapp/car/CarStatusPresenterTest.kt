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

    private fun present(status: GatewayStatus, now: Long) = CarStatusPresenter.present(status, "car-a", true, now)
}
