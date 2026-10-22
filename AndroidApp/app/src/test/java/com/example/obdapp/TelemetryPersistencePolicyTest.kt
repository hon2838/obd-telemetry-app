package com.example.obdapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TelemetryPersistencePolicyTest {

    private lateinit var policy: TelemetryPersistencePolicy

    @Before
    fun setUp() {
        policy = TelemetryPersistencePolicy()
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
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = true))

        // Redundant samples every 3s up to 18s are suppressed
        for (elapsed in listOf(3_000L, 6_000L, 9_000L, 12_000L, 15_000L, 18_000L)) {
            val redundant = sample(timestamp = elapsed)
            assertFalse(
                "Sample at +${elapsed}ms should have been suppressed",
                policy.shouldPersist(redundant, obdConnected = false, hasGpsFix = true)
            )
        }

        // Heartbeat at 20s (STATIONARY_HEARTBEAT_MS) is persisted
        val heartbeatSample = sample(timestamp = TelemetryPersistencePolicy.STATIONARY_HEARTBEAT_MS)
        assertTrue(
            "Heartbeat sample at 20s must be persisted",
            policy.shouldPersist(heartbeatSample, obdConnected = false, hasGpsFix = true)
        )

        // Following sample within the new 20s window is suppressed again
        val nextSample = sample(timestamp = 23_000L)
        assertFalse(
            "Sample at 23s should be suppressed after 20s heartbeat baseline",
            policy.shouldPersist(nextSample, obdConnected = false, hasGpsFix = true)
        )

        // Subsequent heartbeat at 40s persists
        val secondHeartbeat = sample(timestamp = 40_000L)
        assertTrue(
            "Second heartbeat sample at 40s must be persisted",
            policy.shouldPersist(secondHeartbeat, obdConnected = false, hasGpsFix = true)
        )
    }

    @Test
    fun schedulingJitterPersistsAtOver20SecondsSafelyUnderServerCeiling() {
        val t0 = sample(timestamp = 0L)
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = true))

        // Simulating cycle scheduling jitter at +20.4 seconds (20,400ms)
        val jitterSample = sample(timestamp = 20_400L)
        assertTrue(
            "Sample at +20.4s should persist, safely under the 30s MAX_INTERVAL_MS server ceiling",
            policy.shouldPersist(jitterSample, obdConnected = false, hasGpsFix = true)
        )
    }

    @Test
    fun clockMovedBackwardsImmediatelyPersists() {
        val t0 = sample(timestamp = 10_000L)
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = true))

        val backwardsSample = sample(timestamp = 9_500L)
        assertTrue(
            "Backward clock jump should persist to avoid stale baseline",
            policy.shouldPersist(backwardsSample, obdConnected = false, hasGpsFix = true)
        )
    }

    @Test
    fun immediatePersistenceWhenMovementStartsByGpsSpeed() {
        val t0 = sample(timestamp = 0L, gpsSpeed = 0.0f)
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = true))

        // Speed under threshold is suppressed within heartbeat window
        val slowSample = sample(timestamp = 3_000L, gpsSpeed = 0.5f)
        assertFalse(policy.shouldPersist(slowSample, obdConnected = false, hasGpsFix = true))

        // Speed at threshold (1.0 km/h) persists immediately
        val thresholdSample = sample(timestamp = 6_000L, gpsSpeed = TelemetryPersistencePolicy.STATIONARY_SPEED_THRESHOLD_KMH)
        assertTrue(policy.shouldPersist(thresholdSample, obdConnected = false, hasGpsFix = true))

        // Speed above threshold persists immediately
        val fastSample = sample(timestamp = 9_000L, gpsSpeed = 35.0f)
        assertTrue(policy.shouldPersist(fastSample, obdConnected = false, hasGpsFix = true))

        // Transitioning back to stationary (0.0 km/h) persists immediately as stop sample,
        // then suppresses subsequent stationary samples within the heartbeat window
        val stopSample = sample(timestamp = 12_000L, gpsSpeed = 0.0f)
        assertTrue(policy.shouldPersist(stopSample, obdConnected = false, hasGpsFix = true))

        val redundantStationary = sample(timestamp = 15_000L, gpsSpeed = 0.0f)
        assertFalse(policy.shouldPersist(redundantStationary, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun immediatePersistenceWhenMovementStartsByCoordinateDelta() {
        val lat0 = 37.77490
        val lon0 = -122.41940
        val t0 = sample(timestamp = 0L, latitude = lat0, longitude = lon0)
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = true))

        // Coordinate drift within epsilon is suppressed
        val jitterSample = sample(
            timestamp = 3_000L,
            latitude = lat0 + 0.00002, // 0.00002 <= 0.00005
            longitude = lon0
        )
        assertFalse(policy.shouldPersist(jitterSample, obdConnected = false, hasGpsFix = true))

        // Latitude change beyond epsilon persists
        val latMovedSample = sample(
            timestamp = 6_000L,
            latitude = lat0 + 0.00006, // 0.00006 > 0.00005
            longitude = lon0
        )
        assertTrue(policy.shouldPersist(latMovedSample, obdConnected = false, hasGpsFix = true))

        // Longitude change beyond epsilon persists
        val lonMovedSample = sample(
            timestamp = 9_000L,
            latitude = lat0 + 0.00006,
            longitude = lon0 + 0.00006
        )
        assertTrue(policy.shouldPersist(lonMovedSample, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun coordinateDeltaIgnoredWhenNoGpsFix() {
        val t0 = sample(timestamp = 0L, latitude = 0.0, longitude = 0.0)
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = false))

        val deltaNoFix = sample(timestamp = 3_000L, latitude = 37.7749, longitude = -122.4194)
        assertFalse(policy.shouldPersist(deltaNoFix, obdConnected = false, hasGpsFix = false))
    }

    @Test
    fun immediatePersistenceWhenObdConnectedIsTrue() {
        val t0 = sample(timestamp = 0L)
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = true))

        // All OBD connected samples are persisted (dense sampling)
        val s1 = sample(timestamp = 3_000L)
        assertTrue(policy.shouldPersist(s1, obdConnected = true, hasGpsFix = true))

        val s2 = sample(timestamp = 6_000L)
        assertTrue(policy.shouldPersist(s2, obdConnected = true, hasGpsFix = true))

        val s3 = sample(timestamp = 9_000L)
        assertTrue(policy.shouldPersist(s3, obdConnected = true, hasGpsFix = true))
    }

    @Test
    fun immediatePersistenceWhenRpmSpeedOrAccelTimeNonNull() {
        val t0 = sample(timestamp = 0L)
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = true))

        val rpmSample = sample(timestamp = 3_000L, rpm = 800)
        assertTrue(policy.shouldPersist(rpmSample, obdConnected = false, hasGpsFix = true))

        val speedSample = sample(timestamp = 6_000L, speed = 15)
        assertTrue(policy.shouldPersist(speedSample, obdConnected = false, hasGpsFix = true))

        val sprintSample = sample(timestamp = 9_000L, accelTime = 6.4)
        assertTrue(policy.shouldPersist(sprintSample, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun immediatePersistenceOnStateTransitions() {
        // OBD disconnect transition
        val obdConnectedSample = sample(timestamp = 0L)
        assertTrue(policy.shouldPersist(obdConnectedSample, obdConnected = true, hasGpsFix = true))

        val obdDisconnectedSample = sample(timestamp = 3_000L)
        assertTrue(
            "Disconnecting OBD should trigger persistence",
            policy.shouldPersist(obdDisconnectedSample, obdConnected = false, hasGpsFix = true)
        )

        // GPS fix lost transition
        val gpsLostSample = sample(timestamp = 6_000L)
        assertTrue(
            "Losing GPS fix should trigger persistence",
            policy.shouldPersist(gpsLostSample, obdConnected = false, hasGpsFix = false)
        )

        // GPS fix acquired transition
        val gpsAcquiredSample = sample(timestamp = 9_000L)
        assertTrue(
            "Acquiring GPS fix should trigger persistence",
            policy.shouldPersist(gpsAcquiredSample, obdConnected = false, hasGpsFix = true)
        )

        // ACC state transition
        val accOffSample = sample(timestamp = 12_000L, accOn = false)
        assertTrue(policy.shouldPersist(accOffSample, obdConnected = false, hasGpsFix = true))

        val accOnSample = sample(timestamp = 15_000L, accOn = true)
        assertTrue(policy.shouldPersist(accOnSample, obdConnected = false, hasGpsFix = true))

        // Headlight state transition
        val headlightSample = sample(timestamp = 18_000L, headlightOn = true)
        assertTrue(policy.shouldPersist(headlightSample, obdConnected = false, hasGpsFix = true))

        // Bluetooth connected state transition
        val btSample = sample(timestamp = 21_000L, headlightOn = true, btConnected = true)
        assertTrue(policy.shouldPersist(btSample, obdConnected = false, hasGpsFix = true))

        // Coolant temp transition
        val coolantSample = sample(timestamp = 24_000L, headlightOn = true, btConnected = true, coolantTemp = 90)
        assertTrue(policy.shouldPersist(coolantSample, obdConnected = false, hasGpsFix = true))

        // Alert coolant transition
        val alertCoolantSample = sample(
            timestamp = 27_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertCoolant = true
        )
        assertTrue(policy.shouldPersist(alertCoolantSample, obdConnected = false, hasGpsFix = true))

        // Active alert coolant stays persisted
        val alertCoolantActiveSample = sample(
            timestamp = 30_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertCoolant = true
        )
        assertTrue(policy.shouldPersist(alertCoolantActiveSample, obdConnected = false, hasGpsFix = true))

        // Alert coolant cleared transition
        val alertCoolantClearedSample = sample(
            timestamp = 33_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertCoolant = false
        )
        assertTrue(policy.shouldPersist(alertCoolantClearedSample, obdConnected = false, hasGpsFix = true))

        // Alert voltage transition
        val alertVoltageSample = sample(
            timestamp = 36_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertVoltage = true
        )
        assertTrue(policy.shouldPersist(alertVoltageSample, obdConnected = false, hasGpsFix = true))

        val alertVoltageClearedSample = sample(
            timestamp = 39_000L,
            headlightOn = true,
            btConnected = true,
            coolantTemp = 90,
            alertVoltage = false
        )
        assertTrue(policy.shouldPersist(alertVoltageClearedSample, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun voltageTransitionsTriggerImmediatePersistenceOnMeaningfulChange() {
        val t0 = sample(timestamp = 0L, voltage = 12.6f)
        assertTrue(policy.shouldPersist(t0, obdConnected = false, hasGpsFix = true))

        // Minor change (<0.2V) is suppressed
        val minorChange = sample(timestamp = 3_000L, voltage = 12.7f)
        assertFalse(policy.shouldPersist(minorChange, obdConnected = false, hasGpsFix = true))

        // Shift >= 0.2V (12.6f -> 12.4f) persists immediately
        val majorDrop = sample(timestamp = 6_000L, voltage = 12.4f)
        assertTrue(policy.shouldPersist(majorDrop, obdConnected = false, hasGpsFix = true))

        // Minor change from 12.4f (<0.2V) is suppressed
        val minorDrop = sample(timestamp = 9_000L, voltage = 12.35f)
        assertFalse(policy.shouldPersist(minorDrop, obdConnected = false, hasGpsFix = true))

        // Non-null to null persists
        val nullVoltage = sample(timestamp = 12_000L, voltage = null)
        assertTrue(policy.shouldPersist(nullVoltage, obdConnected = false, hasGpsFix = true))

        // Null to null suppressed
        val stillNullVoltage = sample(timestamp = 15_000L, voltage = null)
        assertFalse(policy.shouldPersist(stillNullVoltage, obdConnected = false, hasGpsFix = true))

        // Null to non-null persists
        val recoveredVoltage = sample(timestamp = 18_000L, voltage = 12.5f)
        assertTrue(policy.shouldPersist(recoveredVoltage, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun vehicleIdChangeImmediatelyPersists() {
        val veh1 = sample(timestamp = 0L, vehicleId = "veh-1")
        assertTrue(policy.shouldPersist(veh1, obdConnected = false, hasGpsFix = true))

        val veh2 = sample(timestamp = 3_000L, vehicleId = "veh-2")
        assertTrue(policy.shouldPersist(veh2, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun resetClearsStateAndReenablesInitialPersistence() {
        val s = sample(timestamp = 0L)
        assertTrue(policy.shouldPersist(s, obdConnected = false, hasGpsFix = true))

        val redundant = sample(timestamp = 3_000L)
        assertFalse(policy.shouldPersist(redundant, obdConnected = false, hasGpsFix = true))

        policy.reset()

        // Same redundant sample now acts as the first sample after reset
        assertTrue(policy.shouldPersist(redundant, obdConnected = false, hasGpsFix = true))
    }

    @Test
    fun customHeartbeatIntervalIsHonored() {
        val customPolicy = TelemetryPersistencePolicy(stationaryHeartbeatMs = 5_000L)
        val s0 = sample(timestamp = 0L)
        assertTrue(customPolicy.shouldPersist(s0, obdConnected = false, hasGpsFix = true))

        val s3 = sample(timestamp = 3_000L)
        assertFalse(customPolicy.shouldPersist(s3, obdConnected = false, hasGpsFix = true))

        val s5 = sample(timestamp = 5_000L)
        assertTrue(customPolicy.shouldPersist(s5, obdConnected = false, hasGpsFix = true))
    }
}
