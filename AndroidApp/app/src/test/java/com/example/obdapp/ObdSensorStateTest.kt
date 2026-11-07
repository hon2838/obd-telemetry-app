package com.example.obdapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ObdSensorStateTest {
    @Test
    fun disconnectInvalidatesEveryObdReadingAndRetryDeadline() {
        val state = ObdSensorState(retryDelayMs = 300_000L)
        val session = state.beginConnection()
        populate(state, session)
        state.deferSlowPid(session, ObdSensorState.SlowPid.COOLANT, 10_000L)
        state.deferSlowPid(session, ObdSensorState.SlowPid.MODULE_VOLTAGE, 10_000L)
        state.deferSlowPid(session, ObdSensorState.SlowPid.FUEL_LEVEL, 10_000L)
        state.deferSlowPid(session, ObdSensorState.SlowPid.AMBIENT_TEMP, 10_000L)
        state.deferSlowPid(session, ObdSensorState.SlowPid.INTAKE_AIR_TEMP, 10_000L)
        state.deferSlowPid(session, ObdSensorState.SlowPid.MANIFOLD_PRESSURE, 10_000L)
        state.deferEngineLoad(session, 10_000L)
        state.deferThrottlePosition(session, 10_000L)
        state.deferFuelEstimate(session, 10_000L)
        // Keep readings and retry deadlines present simultaneously before reset.
        populate(state, session)

        state.disconnect()

        assertNull(state.snapshot(session))
        val nextSession = state.beginConnection()
        assertNotEquals(session, nextSession)
        val next = state.snapshot(nextSession)!!
        assertNull(next.coolantTemp)
        assertNull(next.moduleVoltage)
        assertNull(next.fuelLevel)
        assertNull(next.ambientTemp)
        assertNull(next.intakeAirTemp)
        assertNull(next.manifoldPressure)
        assertNull(next.engineLoad)
        assertNull(next.throttlePosition)
        assertTrue(next.slowPidRetryAfter.all { it == 0L })
        assertEquals(0L, next.engineLoadRetryAfter)
        assertEquals(0L, next.throttleRetryAfter)
        assertEquals(0L, next.fuelEstimateRetryAfter)
    }

    @Test
    fun reinitializationStartsCleanSessionAndRejectsLateOldConnectionWrites() {
        val state = ObdSensorState()
        val oldSession = state.beginConnection()
        state.updateCoolantTemp(oldSession, 108)
        state.deferSlowPid(oldSession, ObdSensorState.SlowPid.FUEL_LEVEL, 100L)

        val currentSession = state.beginConnection()
        assertNotEquals(oldSession, currentSession)
        assertNull(state.snapshot(oldSession))
        assertTrue(state.isCurrentSession(currentSession))
        assertFalse(state.isCurrentSession(oldSession))

        // A cancelled/late read from the previous connection cannot contaminate the new one.
        assertFalse(state.updateCoolantTemp(oldSession, 111))
        assertFalse(state.deferSlowPid(oldSession, ObdSensorState.SlowPid.MODULE_VOLTAGE, 5_000L))
        val current = state.snapshot(currentSession)!!
        assertNull(current.coolantTemp)
        assertNull(current.moduleVoltage)
        assertEquals(0L, current.slowPidRetryAfter[ObdSensorState.SlowPid.FUEL_LEVEL.index])
        assertEquals(0L, current.slowPidRetryAfter[ObdSensorState.SlowPid.MODULE_VOLTAGE.index])
    }

    @Test
    fun currentSessionRetainsFiveMinutePerPidRetryAndSensorUpdates() {
        val state = ObdSensorState()
        val session = state.beginConnection()
        state.updateModuleVoltage(session, 13.8f)
        state.updateEngineLoad(session, 42)
        state.deferSlowPid(session, ObdSensorState.SlowPid.FUEL_LEVEL, 20_000L)
        state.deferThrottlePosition(session, 20_000L)
        state.deferFuelEstimate(session, 20_000L)

        val current = state.snapshot(session)!!
        assertEquals(13.8f, current.moduleVoltage!!, 0f)
        assertEquals(42, current.engineLoad)
        assertEquals(320_000L, current.slowPidRetryAfter[ObdSensorState.SlowPid.FUEL_LEVEL.index])
        assertNull(current.fuelLevel)
        assertEquals(320_000L, current.throttleRetryAfter)
        assertEquals(320_000L, current.fuelEstimateRetryAfter)
    }

    private fun populate(state: ObdSensorState, session: Long) {
        state.updateCoolantTemp(session, 90)
        state.updateModuleVoltage(session, 13.5f)
        state.updateFuelLevel(session, 55)
        state.updateAmbientTemp(session, 30)
        state.updateIntakeAirTemp(session, 32)
        state.updateManifoldPressure(session, 100)
        state.updateEngineLoad(session, 25)
        state.updateThrottlePosition(session, 12)
    }
}
