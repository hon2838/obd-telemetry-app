package com.example.obdapp

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TelemetryPersistencePolicyTest {

    private lateinit var policy: TelemetryPersistencePolicy

    @Before
    fun setUp() {
        policy = TelemetryPersistencePolicy()
    }

    private fun persist(
        sample: TelemetryEntity,
        obdConnected: Boolean,
        hasGpsFix: Boolean,
        targetPolicy: TelemetryPersistencePolicy = policy
    ): Boolean = runBlocking {
        targetPolicy.persistIfEligible(sample, obdConnected, hasGpsFix) {}
    }

    private fun sample(
        timestamp: Long = 1_000_000L,
        vehicleId: String = "veh-1",
        rpm: Int? = null,
        speed: Int? = null,
        coolantTemp: Int? = null,
        latitude: Double = 37.7749,
        longitude: Double = -122.4194,
        altitude: Double = 15.0,
        gpsSpeed: Float = 0.0f,
        voltage: Float? = 12.6f,
        accelTime: Double? = null,
        alertCoolant: Boolean? = false,
        alertVoltage: Boolean? = false,
        accOn: Boolean? = true,
        headlightOn: Boolean? = false,
        btConnected: Boolean? = false
    ): TelemetryEntity = TelemetryEntity(
        timestamp = timestamp,
        vehicleId = vehicleId,
        rpm = rpm,
        speed = speed,
        coolantTemp = coolantTemp,
        latitude = latitude,
        longitude = longitude,
        altitude = altitude,
        gpsSpeed = gpsSpeed,
        engineLoad = null,
        throttlePos = null,
        fuelLevel = null,
        ambientTemp = null,
        voltage = voltage,
        accelTime = accelTime,
        alertCoolant = alertCoolant,
        alertVoltage = alertVoltage,
        accOn = accOn,
        headlightOn = headlightOn,
        btConnected = btConnected
    )

    @Test
    fun firstStationaryGpsOnlySampleIsPersisted() {
        val s = sample(timestamp = 0L)
        assertTrue(policy.shouldPersist(s, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun stationaryGpsOnlySuppressesRedundantSamplesAndPersistsOn20sHeartbeat() {
        val t0 = sample(timestamp = 0L)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        // Redundant samples every 3s up to 18s are suppressed
        for (elapsed in listOf(3_000L, 6_000L, 9_000L, 12_000L, 15_000L, 18_000L)) {
            val redundant = sample(timestamp = elapsed)
            assertFalse(
                "Sample at +${elapsed}ms should have been suppressed",
                persist(redundant, obdConnected = false, hasGpsFix = true)
            )
        }

        // Heartbeat at 20s (STATIONARY_HEARTBEAT_MS) is persisted
        val heartbeatSample = sample(timestamp = TelemetryPersistencePolicy.STATIONARY_HEARTBEAT_MS)
        assertTrue(
            "Heartbeat sample at 20s must be persisted",
            persist(heartbeatSample, obdConnected = false, hasGpsFix = true)
        )

        // Following sample within the new 20s window is suppressed again
        val nextSample = sample(timestamp = 23_000L)
        assertFalse(
            "Sample at 23s should be suppressed after 20s heartbeat baseline",
            persist(nextSample, obdConnected = false, hasGpsFix = true)
        )

        // Subsequent heartbeat at 40s persists
        val secondHeartbeat = sample(timestamp = 40_000L)
        assertTrue(
            "Second heartbeat sample at 40s must be persisted",
            persist(secondHeartbeat, obdConnected = false, hasGpsFix = true)
        )
    }

    @Test
    fun schedulingJitterPersistsAtOver20SecondsSafelyUnderServerCeiling() {
        val t0 = sample(timestamp = 0L)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        // Simulating cycle scheduling jitter at +20.4 seconds (20,400ms)
        val jitterSample = sample(timestamp = 20_400L)
        assertTrue(
            "Sample at +20.4s should persist, safely under the 30s MAX_INTERVAL_MS server ceiling",
            persist(jitterSample, obdConnected = false, hasGpsFix = true)
        )
    }

    @Test
    fun clockMovedBackwardsImmediatelyPersists() {
        val t0 = sample(timestamp = 10_000L)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        val backwardsSample = sample(timestamp = 9_500L)
        assertTrue(
            "Backward clock jump should persist to avoid stale baseline",
            persist(backwardsSample, obdConnected = false, hasGpsFix = true)
        )
    }

    @Test
    fun immediatePersistenceWhenMovementStartsByGpsSpeed() {
        val t0 = sample(timestamp = 0L, gpsSpeed = 0.0f)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        // Speed under threshold is suppressed within heartbeat window
        val slowSample = sample(timestamp = 3_000L, gpsSpeed = 0.5f)
        assertFalse(persist(slowSample, obdConnected = false, hasGpsFix = true))

        // Speed at threshold (1.0 km/h) persists immediately
        val thresholdSample = sample(timestamp = 6_000L, gpsSpeed = TelemetryPersistencePolicy.STATIONARY_SPEED_THRESHOLD_KMH)
        assertTrue(persist(thresholdSample, obdConnected = false, hasGpsFix = true))

        // Speed above threshold persists immediately
        val fastSample = sample(timestamp = 9_000L, gpsSpeed = 35.0f)
        assertTrue(persist(fastSample, obdConnected = false, hasGpsFix = true))

        // Transitioning back to stationary (0.0 km/h) persists immediately as stop sample,
        // then suppresses subsequent stationary samples within the heartbeat window
        val stopSample = sample(timestamp = 12_000L, gpsSpeed = 0.0f)
        assertTrue(persist(stopSample, obdConnected = false, hasGpsFix = true))

        val redundantStationary = sample(timestamp = 15_000L, gpsSpeed = 0.0f)
        assertFalse(persist(redundantStationary, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun immediatePersistenceWhenMovementStartsByCoordinateDelta() {
        val lat0 = 37.77490
        val lon0 = -122.41940
        val t0 = sample(timestamp = 0L, latitude = lat0, longitude = lon0)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        // Coordinate drift within epsilon is suppressed
        val jitterSample = sample(
            timestamp = 3_000L,
            latitude = lat0 + 0.00002, // 0.00002 <= 0.00005
            longitude = lon0
        )
        assertFalse(persist(jitterSample, obdConnected = false, hasGpsFix = true))

        // Latitude change beyond epsilon persists
        val latMovedSample = sample(
            timestamp = 6_000L,
            latitude = lat0 + 0.00006, // 0.00006 > 0.00005
            longitude = lon0
        )
        assertTrue(persist(latMovedSample, obdConnected = false, hasGpsFix = true))

        // Longitude change beyond epsilon persists
        val lonMovedSample = sample(
            timestamp = 9_000L,
            latitude = lat0 + 0.00006,
            longitude = lon0 + 0.00006
        )
        assertTrue(persist(lonMovedSample, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun coordinateDeltaIgnoredWhenNoGpsFix() {
        val t0 = sample(timestamp = 0L, latitude = 0.0, longitude = 0.0)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = false))

        val deltaNoFix = sample(timestamp = 3_000L, latitude = 37.7749, longitude = -122.4194)
        assertFalse(persist(deltaNoFix, obdConnected = false, hasGpsFix = false))
    }

    @Test
    fun immediatePersistenceWhenObdConnectedIsTrue() {
        val t0 = sample(timestamp = 0L)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        // All OBD connected samples are persisted (dense sampling)
        val s1 = sample(timestamp = 3_000L)
        assertTrue(persist(s1, obdConnected = true, hasGpsFix = true))

        val s2 = sample(timestamp = 6_000L)
        assertTrue(persist(s2, obdConnected = true, hasGpsFix = true))

        val s3 = sample(timestamp = 9_000L)
        assertTrue(persist(s3, obdConnected = true, hasGpsFix = true))
    }

    @Test
    fun immediatePersistenceWhenRpmSpeedOrAccelTimeNonNull() {
        val t0 = sample(timestamp = 0L)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        val rpmSample = sample(timestamp = 3_000L, rpm = 800)
        assertTrue(persist(rpmSample, obdConnected = false, hasGpsFix = true))

        val speedSample = sample(timestamp = 6_000L, speed = 15)
        assertTrue(persist(speedSample, obdConnected = false, hasGpsFix = true))

        val sprintSample = sample(timestamp = 9_000L, accelTime = 6.4)
        assertTrue(persist(sprintSample, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun immediatePersistenceOnStateTransitions() {
        // OBD disconnect transition
        val obdConnectedSample = sample(timestamp = 0L)
        assertTrue(persist(obdConnectedSample, obdConnected = true, hasGpsFix = true))

        val obdDisconnectedSample = sample(timestamp = 3_000L)
        assertTrue(
            "Disconnecting OBD should trigger persistence",
            persist(obdDisconnectedSample, obdConnected = false, hasGpsFix = true)
        )

        // GPS fix lost transition
        val gpsLostSample = sample(timestamp = 6_000L)
        assertTrue(
            "Losing GPS fix should trigger persistence",
            persist(gpsLostSample, obdConnected = false, hasGpsFix = false)
        )

        // GPS fix acquired transition
        val gpsAcquiredSample = sample(timestamp = 9_000L)
        assertTrue(
            "Acquiring GPS fix should trigger persistence",
            persist(gpsAcquiredSample, obdConnected = false, hasGpsFix = true)
        )

        // ACC state transition
        val accOffSample = sample(timestamp = 12_000L, accOn = false)
        assertTrue(persist(accOffSample, obdConnected = false, hasGpsFix = true))

        val accOnSample = sample(timestamp = 15_000L, accOn = true)
        assertTrue(persist(accOnSample, obdConnected = false, hasGpsFix = true))

        // Headlight state transition
        val headlightSample = sample(timestamp = 18_000L, headlightOn = true)
        assertTrue(persist(headlightSample, obdConnected = false, hasGpsFix = true))

        // Bluetooth connected state transition
        val btSample = sample(timestamp = 21_000L, headlightOn = true, btConnected = true)
        assertTrue(persist(btSample, obdConnected = false, hasGpsFix = true))

        // Coolant temp transition
        val coolantSample = sample(timestamp = 24_000L, headlightOn = true, btConnected = true, coolantTemp = 90)
        assertTrue(persist(coolantSample, obdConnected = false, hasGpsFix = true))

        // Alert coolant transition
        val alertCoolantSample = sample(
            timestamp = 27_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertCoolant = true
        )
        assertTrue(persist(alertCoolantSample, obdConnected = false, hasGpsFix = true))

        // Active alert coolant stays persisted
        val alertCoolantActiveSample = sample(
            timestamp = 30_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertCoolant = true
        )
        assertTrue(persist(alertCoolantActiveSample, obdConnected = false, hasGpsFix = true))

        // Alert coolant cleared transition
        val alertCoolantClearedSample = sample(
            timestamp = 33_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertCoolant = false
        )
        assertTrue(persist(alertCoolantClearedSample, obdConnected = false, hasGpsFix = true))

        // Alert voltage transition
        val alertVoltageSample = sample(
            timestamp = 36_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertVoltage = true
        )
        assertTrue(persist(alertVoltageSample, obdConnected = false, hasGpsFix = true))

        val alertVoltageClearedSample = sample(
            timestamp = 39_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertVoltage = false
        )
        assertTrue(persist(alertVoltageClearedSample, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun voltageTransitionsTriggerImmediatePersistenceOnMeaningfulChange() {
        val t0 = sample(timestamp = 0L, voltage = 12.6f)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        // Minor change (<0.2V) is suppressed
        val minorChange = sample(timestamp = 3_000L, voltage = 12.7f)
        assertFalse(persist(minorChange, obdConnected = false, hasGpsFix = true))

        // Shift >= 0.2V (12.6f -> 12.4f) persists immediately
        val majorDrop = sample(timestamp = 6_000L, voltage = 12.4f)
        assertTrue(persist(majorDrop, obdConnected = false, hasGpsFix = true))

        // Minor change from 12.4f (<0.2V) is suppressed
        val minorDrop = sample(timestamp = 9_000L, voltage = 12.35f)
        assertFalse(persist(minorDrop, obdConnected = false, hasGpsFix = true))

        // Non-null to null persists
        val nullVoltage = sample(timestamp = 12_000L, voltage = null)
        assertTrue(persist(nullVoltage, obdConnected = false, hasGpsFix = true))

        // Null to null suppressed
        val stillNullVoltage = sample(timestamp = 15_000L, voltage = null)
        assertFalse(persist(stillNullVoltage, obdConnected = false, hasGpsFix = true))

        // Null to non-null persists
        val recoveredVoltage = sample(timestamp = 18_000L, voltage = 12.5f)
        assertTrue(persist(recoveredVoltage, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun vehicleIdChangeImmediatelyPersists() {
        val veh1 = sample(timestamp = 0L, vehicleId = "veh-1")
        assertTrue(persist(veh1, obdConnected = false, hasGpsFix = true))

        val veh2 = sample(timestamp = 3_000L, vehicleId = "veh-2")
        assertTrue(persist(veh2, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun resetClearsStateAndReenablesInitialPersistence() {
        val s = sample(timestamp = 0L)
        assertTrue(persist(s, obdConnected = false, hasGpsFix = true))

        val redundant = sample(timestamp = 3_000L)
        assertFalse(persist(redundant, obdConnected = false, hasGpsFix = true))

        policy.reset()

        // Same redundant sample now acts as the first sample after reset
        assertTrue(persist(redundant, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun customHeartbeatIntervalIsHonored() {
        val customPolicy = TelemetryPersistencePolicy(stationaryHeartbeatMs = 5_000L)
        val s0 = sample(timestamp = 0L)
        assertTrue(persist(s0, obdConnected = false, hasGpsFix = true, targetPolicy = customPolicy))

        val s3 = sample(timestamp = 3_000L)
        assertFalse(persist(s3, obdConnected = false, hasGpsFix = true, targetPolicy = customPolicy))

        val s5 = sample(timestamp = 5_000L)
        assertTrue(persist(s5, obdConnected = false, hasGpsFix = true, targetPolicy = customPolicy))
    }

    @Test
    fun failedInsertDoesNotAdvanceHeartbeatBaselineAndRecoversOnNextCycle() {
        val t0 = sample(timestamp = 0L)
        assertTrue(persist(t0, obdConnected = false, hasGpsFix = true))

        // Suppress samples at 3s, 6s, 9s, 12s, 15s, 18s
        for (elapsed in listOf(3_000L, 6_000L, 9_000L, 12_000L, 15_000L, 18_000L)) {
            val redundant = sample(timestamp = elapsed)
            assertFalse(
                "Sample at +${elapsed}ms should have been suppressed",
                persist(redundant, obdConnected = false, hasGpsFix = true)
            )
        }

        // At 21s, persistIfEligible is called with an insert lambda that throws RuntimeException
        val sample21s = sample(timestamp = 21_000L)
        val ex = assertThrows(RuntimeException::class.java) {
            runBlocking {
                policy.persistIfEligible(sample21s, obdConnected = false, hasGpsFix = true) {
                    throw RuntimeException("SQLite disk I/O error")
                }
            }
        }
        assertEquals("SQLite disk I/O error", ex.message)

        // At 24s, storage recovers (insert succeeds): verify persistIfEligible returns true
        // and persists immediately at 24s (interval 24s <= 30s ceiling, NOT 42s)
        var insertedSample: TelemetryEntity? = null
        val recoveredAt24s = runBlocking {
            policy.persistIfEligible(sample(timestamp = 24_000L), obdConnected = false, hasGpsFix = true) {
                insertedSample = it
            }
        }
        assertTrue("Storage recovered at 24s; sample must be persisted", recoveredAt24s)
        assertEquals(24_000L, insertedSample?.timestamp)

        // Subsequent sample at 27s is suppressed after the new 24s baseline until 44s (24s + 20s)
        assertFalse(
            "Sample at 27s should be suppressed after 24s heartbeat baseline",
            persist(sample(timestamp = 27_000L), obdConnected = false, hasGpsFix = true)
        )
        for (elapsed in listOf(30_000L, 33_000L, 36_000L, 39_000L, 42_000L)) {
            assertFalse(
                "Sample at ${elapsed}ms should be suppressed",
                persist(sample(timestamp = elapsed), obdConnected = false, hasGpsFix = true)
            )
        }
        assertTrue(
            "Heartbeat sample at 44s (24s + 20s) must be persisted",
            persist(sample(timestamp = 44_000L), obdConnected = false, hasGpsFix = true)
        )
    }

    @Test
    fun failedTransitionInsertRemainsEligibleOnNextCycle() {
        val initial = sample(
            timestamp = 0L,
            voltage = 12.6f,
            accOn = true
        )
        assertTrue(persist(initial, obdConnected = false, hasGpsFix = true))

        // At 3s, simulate a state transition (accOn = false) where insert throws
        val transitionAt3s = sample(
            timestamp = 3_000L,
            voltage = 12.6f,
            accOn = false
        )
        val ex = assertThrows(RuntimeException::class.java) {
            runBlocking {
                policy.persistIfEligible(transitionAt3s, obdConnected = false, hasGpsFix = true) {
                    throw RuntimeException("SQLite disk I/O error")
                }
            }
        }
        assertEquals("SQLite disk I/O error", ex.message)

        // At 6s, with the same transitioned state (accOn = false) and recovered storage,
        // verify persistIfEligible returns true and persists the transition
        val transitionAt6s = sample(
            timestamp = 6_000L,
            voltage = 12.6f,
            accOn = false
        )
        var persistedTransition: TelemetryEntity? = null
        val recoveredAt6s = runBlocking {
            policy.persistIfEligible(transitionAt6s, obdConnected = false, hasGpsFix = true) {
                persistedTransition = it
            }
        }
        assertTrue("Transition sample must be persisted upon storage recovery", recoveredAt6s)
        assertEquals(6_000L, persistedTransition?.timestamp)
        assertEquals(false, persistedTransition?.accOn)
    }

    @Test
    fun shouldPersistIsSideEffectFreeWithoutRecordPersisted() {
        val s0 = sample(timestamp = 0L)
        // Calling shouldPersist repeatedly does not record persistence
        assertTrue(policy.shouldPersist(s0, obdConnected = false, hasGpsFix = true))
        assertTrue(policy.shouldPersist(s0, obdConnected = false, hasGpsFix = true))

        // A sample 3s later would normally be suppressed if s0 was recorded,
        // but because recordPersisted was not called, s3 evaluates with lastPersisted still null
        val s3 = sample(timestamp = 3_000L)
        assertTrue(policy.shouldPersist(s3, obdConnected = false, hasGpsFix = true))

        // Explicitly record s3
        policy.recordPersisted(s3, obdConnected = false, hasGpsFix = true)

        // At 6s with no state changes, shouldPersist returns false
        val s6 = sample(timestamp = 6_000L)
        assertFalse(policy.shouldPersist(s6, obdConnected = false, hasGpsFix = true))
        // Calling shouldPersist again still returns false and does not alter state
        assertFalse(policy.shouldPersist(s6, obdConnected = false, hasGpsFix = true))
    }
}
