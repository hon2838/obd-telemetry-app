package com.example.obdapp

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class TripFuelRepositoryTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val prefs get() = context.getSharedPreferences(TripFuelRepository.PREFS, Context.MODE_PRIVATE)
    private val wall = 1_700_000_000_000L
    @Before fun clear() { prefs.edit().clear().commit() }
    private fun TripFuelRepository.point(t: Long, vehicle: String = "a", rate: Double = 6.0) =
        observe(vehicle, wall + t, t, 60.0, rate, 1)!!

    @Test fun newCollectorRestoresCheckpointWithoutBridgingDowntime() {
        val first = TripFuelRepository(context, 4)
        first.point(1000); first.point(11_000)
        val next = TripFuelRepository(context, 4)
        val result = next.point(12_000)
        assertEquals(10.0, result.economyKmL!!, 0.000001)
        assertEquals(10.0 / 11, result.coverageRatio, 0.000001)
        assertEquals(11.0 / 12, next.point(13_000).coverageRatio, 0.000001)
    }

    @Test fun rebootExpiredCheckpointOrUnknownBootIdentityStartsFresh() {
        val first = TripFuelRepository(context, 4)
        first.point(1000); first.point(11_000); first.close()
        assertNull(TripFuelRepository(context, 5).point(12_000).economyKmL)
        prefs.edit().clear().commit()
        val second = TripFuelRepository(context, 4)
        second.point(1000); second.point(11_000); second.close()
        assertNull(TripFuelRepository(context, 4).point(311_001).economyKmL)
        prefs.edit().clear().commit()
        val unknown = TripFuelRepository(context, -1)
        unknown.point(1000); unknown.point(11_000); unknown.close()
        assertNull(TripFuelRepository(context, -1).point(12_000).economyKmL)
    }

    @Test fun vehicleSwitchRestoresSeparateTotalsAndDoesNotCountTheUnobservedGap() {
        val repo = TripFuelRepository(context, 4)
        repo.point(1000); assertEquals(10.0, repo.point(2000).economyKmL!!, 0.000001)
        assertNull(repo.point(3000, "b", 12.0).economyKmL)
        assertEquals(5.0, repo.point(4000, "b", 12.0).economyKmL!!, 0.000001)
        val back = repo.point(5000)
        assertEquals("a", back.vehicleId)
        assertEquals(10.0, back.economyKmL!!, 0.000001)
        assertEquals(0.25, back.coverageRatio, 0.0)
    }

    @Test fun checkpointsAreThrottledAndCloseFlushesLatestTotals() {
        val repo = TripFuelRepository(context, 4)
        repo.point(1000)
        val first = prefs.getString("a", null)
        repo.point(2000)
        assertEquals(first, prefs.getString("a", null))
        repo.point(11_000)
        assertNotEquals(first, prefs.getString("a", null))
        repo.point(12_000)
        repo.close()
        val closed = prefs.getString("a", null)
        assertNull(repo.observe("a", wall + 13_000, 13_000, 60.0, 6.0, 1))
        assertEquals(closed, prefs.getString("a", null))
        assertEquals(11.0 / 12, TripFuelRepository(context, 4).point(13_000).coverageRatio, 0.000001)
    }

    @Test fun corruptAndWrongVehicleCheckpointsAreDiscarded() {
        prefs.edit().putString("a", "not-json").commit()
        assertNull(TripFuelRepository(context, 4).point(1000).economyKmL)
        val other = TripFuelRepository(context, 4)
        other.point(1000, "b"); other.point(11_000, "b"); other.close()
        prefs.edit().putString("a", prefs.getString("b", null)).commit()
        assertNull(TripFuelRepository(context, 4).point(12_000).economyKmL)
    }

    @Test fun checkpointCountRemainsBoundedAcrossDisposableVehicles() {
        val repo = TripFuelRepository(context, 4)
        repeat(TripFuelRepository.MAX_VEHICLES + 4) { repo.point((it + 1) * 1000L, "vehicle-$it") }
        repo.close()
        assertEquals(TripFuelRepository.MAX_VEHICLES, prefs.all.size)
        assertTrue(prefs.contains("vehicle-${TripFuelRepository.MAX_VEHICLES + 3}"))
    }
}
