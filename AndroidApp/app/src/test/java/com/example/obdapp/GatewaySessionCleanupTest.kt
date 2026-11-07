package com.example.obdapp

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class GatewaySessionCleanupTest {
    @Test fun transportLossClearsThePublishedSessionAndRejectsLateReadResults() {
        val controller = Robolectric.buildService(OBDGatewayService::class.java)
        val service = controller.get()
        val state = ReflectionHelpers.getField<ObdSensorState>(service, "obdSensorState")
        val session = seedSession(service, state)
        try {
            ReflectionHelpers.callInstanceMethod<Unit>(service, "handleObdDisconnect")
            assertNull(ReflectionHelpers.getField<Any?>(service, "obdConnection"))
            assertNull(ReflectionHelpers.getField<Any?>(service, "obdSensorSession"))
            assertNull(state.snapshot(session))
            assertFalse(state.updateCoolantTemp(session, 114))
            val replacement = state.beginConnection()
            assertNull(state.snapshot(replacement)!!.coolantTemp)
            assertTrue(state.snapshot(replacement)!!.slowPidRetryAfter.all { it == 0L })
        } finally { controller.destroy() }
    }

    @Test fun serviceDestructionClosesItsSubscriptionAndInvalidatesSensorSession() {
        val controller = Robolectric.buildService(OBDGatewayService::class.java)
        val service = controller.get()
        val state = ReflectionHelpers.getField<ObdSensorState>(service, "obdSensorState")
        val session = seedSession(service, state)
        var closes = 0
        ReflectionHelpers.setField(service, "networkWakeupSubscription", Closeable { closes++ })
        controller.destroy()
        assertEquals(1, closes)
        assertNull(ReflectionHelpers.getField<Any?>(service, "networkWakeupSubscription"))
        assertNull(ReflectionHelpers.getField<Any?>(service, "obdConnection"))
        assertNull(state.snapshot(session))
        assertFalse(state.updateModuleVoltage(session, 11.2f))
    }

    private fun seedSession(service: OBDGatewayService, state: ObdSensorState): Long {
        val session = state.beginConnection()
        state.updateCoolantTemp(session, 112)
        state.updateModuleVoltage(session, 11.4f)
        state.deferSlowPid(session, ObdSensorState.SlowPid.FUEL_LEVEL, 1000)
        ReflectionHelpers.setField(service, "obdSensorSession", session)
        ReflectionHelpers.setField(service, "obdConnection", PromptObdConnection(
            ByteArrayInputStream(byteArrayOf()), ByteArrayOutputStream()
        ))
        return session
    }
}
