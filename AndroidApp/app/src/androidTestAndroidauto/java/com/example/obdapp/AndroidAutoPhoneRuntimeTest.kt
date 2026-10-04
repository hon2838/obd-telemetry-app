package com.example.obdapp

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.scrollTo
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.espresso.matcher.ViewMatchers.isEnabled
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.hamcrest.Matchers.not

/**
 * Live phone-collector instrumentation for the fresh androidauto phone package
 * (com.example.obdapp.androidauto) on the connected Pixel.
 *
 * Uses the real MainActivity via ActivityScenario, real Start/Stop clicks, the
 * real OBDGatewayService and GatewayStatusStore, and Room for local persistence.
 * No Bluetooth adapter is ever selected, so no BT connection is attempted. No
 * cloud data is used: the app API base URL is pointed at a loopback black hole
 * before activity launch and restored afterwards, and the suite asserts the
 * device is unpaired (isDeviceConfigured == false) before live collection.
 * No credentials or coordinates are read, printed, or asserted.
 */
@RunWith(AndroidJUnit4::class)
class AndroidAutoPhoneRuntimeTest {

    companion object {
        private const val LOOPBACK_API_URL = "http://127.0.0.1:9"
        private const val START_TIMEOUT_MS = 20_000L
        private const val RECORD_TIMEOUT_MS = 30_000L
        private const val STOP_TIMEOUT_MS = 15_000L
        private const val POLL_MS = 250L
    }

    private var scenarioToClose: ActivityScenario<MainActivity>? = null
    private var originalApiUrlToRestore: String? = null

    private fun appContext(): Context =
        ApplicationProvider.getApplicationContext()

    private fun awaitCondition(timeoutMs: Long, condition: () -> Boolean): Boolean {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            try {
                if (condition()) return true
            } catch (_: Exception) {
            }
            SystemClock.sleep(POLL_MS)
        }
        return try {
            condition()
        } catch (_: Exception) {
            false
        }
    }

    private fun dismissPairingDialogIfShown() {
        try {
            onView(withText("Cancel")).inRoot(isDialog()).perform(click())
        } catch (_: Exception) {
        }
    }

    private fun stopCollectorService() {
        try {
            val ctx = appContext()
            ctx.stopService(Intent(ctx, OBDGatewayService::class.java))
        } catch (_: Exception) {
        }
    }

    private fun awaitServiceStopped(timeoutMs: Long): Boolean =
        awaitCondition(timeoutMs) {
            !OBDGatewayService.isRunning && !GatewayStatusStore.status.value.running
        }

    @After
    fun tearDownGuaranteeStoppedAndUrlRestored() {
        // No Espresso fallback here: manifest-only cases have no activity.
        stopCollectorService()
        val stopped = awaitServiceStopped(5_000L)
        try {
            scenarioToClose?.close()
        } finally {
            scenarioToClose = null
            originalApiUrlToRestore?.let { saveApiBaseUrl(appContext(), it) }
            originalApiUrlToRestore = null
        }
        assertTrue("Cleanup must leave collection stopped", stopped)
        // Restore runtime permissions only after the runner exits.
    }

    @Test
    fun phoneManifest_hasNoBackgroundLocation() {
        val ctx = appContext()
        val pm = ctx.packageManager
        val pkg = ctx.packageName
        val info = pm.getPackageInfo(pkg, PackageManager.GET_PERMISSIONS)
        val requested = (info.requestedPermissions ?: emptyArray()).toList()
        assertFalse(
            "Phone manifest must not request background location, got: $requested",
            requested.contains(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        )
    }

    @Test
    fun phoneManifest_hasNoBootReceiver() {
        val ctx = appContext()
        try {
            val receiver = pmReceiverInfo(ctx)
            // If the component still exists it must be disabled for the phone app.
            assertFalse(
                "BootReceiver must be disabled for the phone app",
                receiver.enabled
            )
        } catch (_: PackageManager.NameNotFoundException) {
            // Receiver removal is the expected phone configuration.
        }
    }

    private fun pmReceiverInfo(ctx: Context) =
        ctx.packageManager.getReceiverInfo(
            ComponentName(ctx, BootReceiver::class.java),
            PackageManager.GET_META_DATA
        )

    @Test
    fun launch_doesNotAutoStartCollector() {
        val ctx = appContext()
        stopCollectorService()
        awaitServiceStopped(5_000L)

        // Keep the BT adapter unselected so no connection is ever attempted.
        VehiclePrefs.setActiveAdapterMac(ctx, null)

        // Point ONLY the API base URL at a loopback black hole BEFORE launch
        // so the pairing dialog cannot reach the real server.
        originalApiUrlToRestore = getApiBaseUrl(ctx)
        saveApiBaseUrl(ctx, LOOPBACK_API_URL)

        var scenario: ActivityScenario<MainActivity>? = null
        try {
            scenario = ActivityScenario.launch(MainActivity::class.java)
            scenarioToClose = scenario
            dismissPairingDialogIfShown()

            // No boot/autostart: targetSdk >= 31 disables AUTO_START_BOOT and the
            // androidauto manifest removes BootReceiver. Launch must stay stopped.
            SystemClock.sleep(3_000L)
            dismissPairingDialogIfShown()

            assertFalse(
                "Collector must not autostart on launch",
                OBDGatewayService.isRunning
            )
            assertFalse(
                "GatewayStatusStore must not publish running on launch",
                GatewayStatusStore.status.value.running
            )
            assertNull(
                "Selected BT adapter must stay unset",
                VehiclePrefs.getActiveAdapterMac(ctx)
            )
        } finally {
            try {
                scenario?.close()
            } catch (_: Exception) {
            }
            scenarioToClose = null
            stopCollectorService()
            awaitServiceStopped(5_000L)
            try {
                val restore = originalApiUrlToRestore
                if (restore != null) {
                    saveApiBaseUrl(ctx, restore)
                    originalApiUrlToRestore = null
                }
            } catch (_: Exception) {
            }
        }
        assertFalse(
            "Collector must be stopped after launch test",
            OBDGatewayService.isRunning
        )
    }

    @Test
    fun grantedForegroundStart_recordsLocally_andStopClearsStatus() {
        val ctx = appContext()

        // Baseline: collector fully stopped before the live run.
        stopCollectorService()
        assertTrue(
            "Collector must stop before live run",
            awaitServiceStopped(10_000L)
        )

        // Skip any Bluetooth connection attempt by retaining an unset adapter.
        VehiclePrefs.setActiveAdapterMac(ctx, null)
        assertNull(
            "Selected BT adapter must stay unset",
            VehiclePrefs.getActiveAdapterMac(ctx)
        )

        // No paired cloud credentials before live collection (boolean only;
        // never read or print credential values).
        assertFalse(
            "Fresh phone app must be unpaired before live collection",
            isDeviceConfigured(ctx)
        )

        val activeVehicleId = VehiclePrefs.getActiveVehicleId(ctx)
        val countBefore = runBlocking {
            AppDatabase.getDatabase(ctx).telemetryDao()
                .countUnsyncedForVehicle(activeVehicleId)
        }

        // Prevent automatic pairing HTTP to the real server: loopback only.
        originalApiUrlToRestore = getApiBaseUrl(ctx)
        saveApiBaseUrl(ctx, LOOPBACK_API_URL)
        assertEquals(LOOPBACK_API_URL, getApiBaseUrl(ctx))

        var scenario: ActivityScenario<MainActivity>? = null
        try {
            scenario = ActivityScenario.launch(MainActivity::class.java)
            scenarioToClose = scenario
            dismissPairingDialogIfShown()

            // Still unpaired after launch; still no adapter selected.
            assertFalse(
                "Must stay unpaired before pressing Start",
                isDeviceConfigured(ctx)
            )
            assertNull(
                "Selected BT adapter must stay unset before Start",
                VehiclePrefs.getActiveAdapterMac(ctx)
            )

            // Real foreground start via the actual Start button.
            onView(withId(R.id.btnStart)).perform(scrollTo(), click())

            assertTrue(
                "Granted foreground Start must publish service running",
                awaitCondition(START_TIMEOUT_MS) { OBDGatewayService.isRunning }
            )
            assertTrue(
                "Granted foreground Start must publish GatewayStatusStore running",
                awaitCondition(START_TIMEOUT_MS) { GatewayStatusStore.status.value.running }
            )

            // Local recording without cloud credentials: unsynced Room rows grow
            // on the GPS-only path (no adapter, loopback API, unpaired device).
            val recorded = awaitCondition(RECORD_TIMEOUT_MS) {
                runBlocking {
                    AppDatabase.getDatabase(ctx).telemetryDao()
                        .countUnsyncedForVehicle(activeVehicleId)
                } > countBefore
            }
            assertTrue(
                "Collector must record locally without paired cloud credentials",
                recorded
            )
            assertFalse(
                "Must stay unpaired during local collection",
                isDeviceConfigured(ctx)
            )

            val foregroundCount = runBlocking {
                AppDatabase.getDatabase(ctx).telemetryDao().countUnsyncedForVehicle(activeVehicleId)
            }
            scenario.moveToState(Lifecycle.State.CREATED)
            assertTrue("Local recording must continue while the phone activity is stopped",
                awaitCondition(15_000L) {
                    runBlocking {
                        AppDatabase.getDatabase(ctx).telemetryDao().countUnsyncedForVehicle(activeVehicleId)
                    } > foregroundCount
                })
            assertTrue(OBDGatewayService.isRunning)
            scenario.moveToState(Lifecycle.State.RESUMED)

            // Real stop via the actual Stop button.
            onView(withId(R.id.btnStop)).perform(scrollTo()).check(matches(isEnabled())).perform(click())
            // The listener immediately changes these controls. Keep the genuine
            // tap: a failure here means callback delivery, not service teardown.
            onView(withId(R.id.btnStop)).check(matches(not(isEnabled())))
            onView(withId(R.id.statusText)).check(matches(withText("Service Stopped")))

            val stopped = awaitServiceStopped(STOP_TIMEOUT_MS)
            assertTrue("Stopping must clear running status: service=${OBDGatewayService.isRunning}, published=${GatewayStatusStore.status.value.running}", stopped)
            assertFalse(
                "Service must report stopped after Stop",
                OBDGatewayService.isRunning
            )
            assertFalse(
                "GatewayStatusStore must report stopped after Stop",
                GatewayStatusStore.status.value.running
            )
        } finally {
            // Guarantee Stop even on assertion failure; leave collector stopped.
            try {
                try {
                    onView(withId(R.id.btnStop)).perform(scrollTo(), click())
                } catch (_: Exception) {
                }
            } catch (_: Exception) {
            }
            stopCollectorService()
            awaitServiceStopped(10_000L)
            try {
                scenario?.close()
            } catch (_: Exception) {
            }
            scenarioToClose = null
            try {
                val restore = originalApiUrlToRestore
                if (restore != null) {
                    saveApiBaseUrl(ctx, restore)
                    originalApiUrlToRestore = null
                }
            } catch (_: Exception) {
            }
            stopCollectorService()
            awaitServiceStopped(5_000L)
        }

        assertFalse(
            "Collector must be left stopped",
            OBDGatewayService.isRunning
        )
        assertFalse(
            "GatewayStatusStore must be left stopped",
            GatewayStatusStore.status.value.running
        )
        assertFalse(
            "Must remain unpaired after the live run",
            isDeviceConfigured(ctx)
        )
    }
}
