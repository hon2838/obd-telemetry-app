package com.example.obdapp

import android.Manifest
import android.app.Notification
import android.app.Service
import android.bluetooth.BluetoothSocket
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowContextWrapper
import org.robolectric.util.ReflectionHelpers
import java.io.IOException

/** Injects OS startup rejection; SDK 29 is not expected to enforce phone SDK 36 rules itself. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], shadows = [RejectingForegroundServiceShadow::class])
class GatewayStartupTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private var originalTarget = 0

    @Before fun setup() {
        originalTarget = context.applicationInfo.targetSdkVersion
        context.applicationInfo.targetSdkVersion = 36
        GatewayStatusStore.setRunning(false)
    }

    @After fun cleanup() {
        context.applicationInfo.targetSdkVersion = originalTarget
        RejectingForegroundServiceShadow.failure = SecurityException("permission revoked")
        GatewayStatusStore.setRunning(false)
    }

    @Test fun permissionDenialCannotBeUndoneByALateStartCallback() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).denyPermissions(
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        val controller = Robolectric.buildService(OBDGatewayService::class.java).create()
        try {
            grantLocation()
            assertStopped(controller.get())
        } finally { controller.destroy() }
    }

    @Test fun permissionRevocationDuringPromotionStopsWithoutPublishingRunning() {
        assertPromotionRejected(SecurityException("permission revoked during promotion"))
    }

    @Test fun backgroundStartRejectionStopsWithoutLaunchingCollection() {
        assertPromotionRejected(IllegalStateException("foreground start no longer allowed"))
    }

    @Test @Config(shadows = [RejectingForegroundServiceShadow::class, FailingSocketCloseShadow::class])
    fun socketCloseFailureStillPublishesStoppedState() {
        val controller = Robolectric.buildService(OBDGatewayService::class.java).create()
        ReflectionHelpers.setField(controller.get(), "bluetoothSocket", Shadow.newInstanceOf(BluetoothSocket::class.java))
        controller.destroy()
        assertFalse(GatewayStatusStore.status.value.running)
        assertFalse(shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).broadcastIntents.last().getBooleanExtra("running", true))
    }

    private fun assertPromotionRejected(error: RuntimeException) {
        grantLocation()
        RejectingForegroundServiceShadow.failure = error
        val controller = Robolectric.buildService(OBDGatewayService::class.java).create()
        try { assertStopped(controller.get()) } finally { controller.destroy() }
        val stopped = shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).broadcastIntents.last()
        assertFalse(stopped.getBooleanExtra("running", true))
        val message = stopped.getStringExtra("status")!!
        assertTrue(if (error is SecurityException) message.contains("Permissions denied") else message.contains("press Start"))
    }

    private fun assertStopped(service: OBDGatewayService) {
        assertFalse(OBDGatewayService.isRunning)
        assertFalse(GatewayStatusStore.status.value.running)
        assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1))
        assertTrue(Shadow.extract<RejectingForegroundServiceShadow>(service).stopped)
        assertFalse(GatewayStatusStore.status.value.running)
    }

    private fun grantLocation() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    }
}

@Implements(Service::class)
class RejectingForegroundServiceShadow : ShadowContextWrapper() {
    var stopped = false
    @Implementation protected fun startForeground(id: Int, notification: Notification) { throw failure }
    @Implementation protected fun stopSelf() { stopped = true }
    companion object { var failure: RuntimeException = SecurityException("permission revoked") }
}

@Implements(BluetoothSocket::class)
class FailingSocketCloseShadow {
    @Implementation protected fun close() { throw IOException("socket already disconnected") }
}
