package com.example.obdapp.car

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.Signature
import androidx.car.app.HostInfo
import android.os.SystemClock
import android.os.Looper
import androidx.lifecycle.Lifecycle
import androidx.car.app.testing.ScreenController
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.LooperMode
import java.util.concurrent.TimeUnit
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.PaneTemplate
import androidx.car.app.testing.TestCarContext
import androidx.test.core.app.ApplicationProvider
import com.example.obdapp.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@LooperMode(LooperMode.Mode.PAUSED)
class DeviceStatusScreenTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @After fun clear() {
        GatewayStatusStore.setRunning(false)
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun unpairedPhoneGetsSetupMessageWithoutAnyActions() {
        val screen = DeviceStatusScreen(TestCarContext.createCarContext(context))
        val template = screen.onGetTemplate() as MessageTemplate
        assertTrue(template.message.toString().contains("safely parked"))
        assertTrue(template.actions.isEmpty())
    }

    @Test fun configuredPhoneGetsThreeReadOnlyStatusRows() {
        saveDeviceToken(context, "obd_dev_local_test_fixture")
        GatewayStatusStore.recordSample("default", true, SystemClock.elapsedRealtime(), SystemClock.elapsedRealtime())
        val template = DeviceStatusScreen(TestCarContext.createCarContext(context)).onGetTemplate() as PaneTemplate
        assertEquals(3, template.pane.rows.size)
        assertTrue(template.pane.actions.isEmpty())
        assertTrue(template.pane.rows.all { it.onClickDelegate == null })
        assertNotNull(template.actionStrip)
        assertEquals(1, template.actionStrip!!.actions.size)
        assertEquals(context.getString(R.string.car_action_live_gauges), template.actionStrip!!.actions[0].title.toString())
    }

    @Test fun visibleScreenExpiresGpsWithoutAnotherTelemetrySample() {
        saveDeviceToken(context, "obd_dev_local_test_fixture")
        val now = SystemClock.elapsedRealtime()
        GatewayStatusStore.recordSample("default", true, now, now)
        val controller = ScreenController(DeviceStatusScreen(TestCarContext.createCarContext(context)))
            .moveToState(Lifecycle.State.RESUMED)
        try {
            shadowOf(Looper.getMainLooper()).idle()
            val initial = controller.templatesReturned.last() as PaneTemplate
            assertEquals(context.getString(R.string.car_gps_ready), initial.pane.rows[1].texts.single().toString())

            shadowOf(Looper.getMainLooper()).idleFor(12, TimeUnit.SECONDS)
            val expired = controller.templatesReturned.last() as PaneTemplate
            assertEquals(context.getString(R.string.car_gps_waiting), expired.pane.rows[1].texts.single().toString())
        } finally {
            controller.moveToState(Lifecycle.State.DESTROYED)
        }
    }

    @Test fun stoppedScreenDoesNotRefreshAndResumeImmediatelyShowsLatestStatus() {
        saveDeviceToken(context, "obd_dev_local_test_fixture")
        val controller = ScreenController(DeviceStatusScreen(TestCarContext.createCarContext(context)))
            .moveToState(Lifecycle.State.RESUMED)
        try {
            shadowOf(Looper.getMainLooper()).idle()
            controller.moveToState(Lifecycle.State.CREATED)
            controller.reset()
            val now = SystemClock.elapsedRealtime()
            GatewayStatusStore.recordSample("default", true, now, now)
            shadowOf(Looper.getMainLooper()).idleFor(3, TimeUnit.SECONDS)
            assertTrue(controller.templatesReturned.isEmpty())

            controller.moveToState(Lifecycle.State.RESUMED)
            shadowOf(Looper.getMainLooper()).idle()
            val resumed = controller.templatesReturned.last() as PaneTemplate
            assertEquals(context.getString(R.string.car_adapter_connected), resumed.pane.rows[0].texts.single().toString())
        } finally {
            controller.moveToState(Lifecycle.State.DESTROYED)
        }
        controller.reset()
        GatewayStatusStore.setRunning(false)
        shadowOf(Looper.getMainLooper()).idleFor(30, TimeUnit.SECONDS)
        assertTrue(controller.templatesReturned.isEmpty())
    }

    @Test @Config(sdk = [26])
    fun releaseHostRejectsAllowedPackageWithWrongCertificate() {
        val service = Robolectric.buildService(ObdCarAppService::class.java).create().get()
        val flags = service.applicationInfo.flags
        val impostorUid = 12345
        val impostor = PackageInfo().apply {
            packageName = "com.google.android.projection.gearhead"
            applicationInfo = ApplicationInfo().apply {
                packageName = "com.google.android.projection.gearhead"
                uid = impostorUid
            }
            @Suppress("DEPRECATION")
            signatures = arrayOf(Signature("0123456789abcdef"))
        }
        shadowOf(context.packageManager).installPackage(impostor)
        try {
            service.applicationInfo.flags = flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
            assertFalse(service.createHostValidator().isValidHost(HostInfo(impostor.packageName, impostorUid)))
        } finally {
            service.applicationInfo.flags = flags
        }
    }

    @Test fun releaseHostValidationIsRestrictedByPackageAndCertificate() {
        val service = Robolectric.buildService(ObdCarAppService::class.java).create().get()
        val flags = service.applicationInfo.flags
        try {
            service.applicationInfo.flags = flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
            val hosts = service.createHostValidator().allowedHosts
            assertTrue(hosts.containsKey("com.google.android.projection.gearhead"))
            assertFalse(hosts.containsKey("untrusted.car.host"))
        } finally {
            service.applicationInfo.flags = flags
        }
    }
}
