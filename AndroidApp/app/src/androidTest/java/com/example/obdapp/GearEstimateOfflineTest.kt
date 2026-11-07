package com.example.obdapp

import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.widget.CheckBox
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Emulator-only integration coverage: no adapter, collector, credentials, or remote API. */
@RunWith(AndroidJUnit4::class)
class GearEstimateOfflineTest {
    private lateinit var context: Context
    private var scenario: ActivityScenario<MainActivity>? = null
    private lateinit var vehicle: String

    @Before fun launchOffline() {
        assumeTrue("Simulated driving is only allowed on an emulator",
            Build.HARDWARE in listOf("ranchu", "goldfish"))
        context = ApplicationProvider.getApplicationContext()
        assertNull("Disable emulator Wi-Fi and mobile data before this offline suite",
            (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).activeNetwork)
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putBoolean("AUTO_START_BOOT", false)
            .putString(KEY_API_BASE_URL, "http://127.0.0.1:9")
            .putString(KEY_DEVICE_TOKEN, "offline-instrumentation-only")
            .commit()
        context.getSharedPreferences("DASHBOARD_PREFS", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("GEAR_ESTIMATE_PREFS", Context.MODE_PRIVATE).edit().clear().commit()
        vehicle = VehiclePrefs.getActiveVehicleId(context)
        GearEstimatePrefs.setEnabled(context, vehicle, true)
        scenario = ActivityScenario.launch(MainActivity::class.java)
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        assertFalse("The real collector must stay stopped", OBDGatewayService.isRunning)
    }

    @After fun close() { scenario?.close() }

    private fun send(rpm: Int = 2400, speed: Float = 80f, throttle: Int = 10,
                     source: String = "OBD", car: String = vehicle, age: Long = 0,
                     action: String = "com.example.obdapp.TELEMETRY_UPDATE") {
        dispatch(Intent(action).setPackage(context.packageName)
            .putExtra("vehicle_id", car).putExtra("timestamp", System.currentTimeMillis() - age)
            .putExtra("obd_status", "Connected").putExtra("speed_source", source)
            .putExtra("speed", speed).putExtra("rpm", rpm).putExtra("throttle", throttle)
            .putExtra("coolant", 86).putExtra("volt", 13.9f)
            .putExtra("load", 25).putExtra("iat", 36)
            .putExtra("estimated_fuel_economy_kml", 18.5))
    }

    private fun dispatch(intent: Intent) {
        val delivered = CountDownLatch(1)
        context.sendOrderedBroadcast(intent, null, object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) { delivered.countDown() }
        }, null, 0, null, null)
        assertTrue("Timed out delivering ${intent.action}", delivered.await(5, TimeUnit.SECONDS))
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    }

    private fun assertGear(expected: String) {
        scenario!!.onActivity { activity ->
            assertEquals(expected, activity.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
                .findViewById<TextView>(R.id.tvThrottleGear).text.toString())
        }
    }

    private fun settle(rpm: Int = 2400, speed: Float = 80f) {
        repeat(3) { send(rpm, speed); if (it < 2) SystemClock.sleep(550) }
    }

    private fun screenshot(name: String) {
        val frame = CountDownLatch(1)
        scenario!!.onActivity { activity ->
            activity.window.decorView.postOnAnimation {
                activity.window.decorView.postOnAnimation { frame.countDown() }
            }
        }
        assertTrue("Timed out drawing the screenshot", frame.await(3, TimeUnit.SECONDS))
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        File(context.filesDir, "$name.png").outputStream().use {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
        }
        bitmap.recycle()
    }

    @Test fun allFourGearsAndShiftUncertaintyRenderInTheRealActivity() {
        for ((rpm, speed, expected) in listOf(Triple(1860, 15f, "1"), Triple(1750, 25f, "2"),
            Triple(1840, 40f, "3"), Triple(2400, 80f, "4"))) {
            send(rpm, speed)
            assertGear("—")
            settle(rpm, speed)
            assertGear(expected)
        }
        scenario!!.onActivity { activity ->
            val slot = activity.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
            val row = slot.findViewById<View>(R.id.throttleGearRow)
            val fuel = slot.findViewById<View>(R.id.throttleFuelEconomyRow)
            val primary = slot.findViewById<View>(R.id.telemetryPrimaryContent)
            assertEquals(View.VISIBLE, row.visibility)
            assertTrue(row.height > 0)
            assertTrue(row.bottom <= primary.height)
            assertTrue(primary.bottom <= fuel.top)
        }
        screenshot("gear-four-simulated")
        send(3680, 80f)
        assertGear("—")
        screenshot("gear-shift-uncertain")
    }

    @Test fun staleGpsCrossVehicleAndStoppedDataClearTheEstimate() {
        settle(); assertGear("4")
        SystemClock.sleep(2800) // Includes the real one-second UI age ticker.
        assertGear("—")
        settle(); assertGear("4")
        send(source = "GPS"); assertGear("—")
        settle(); assertGear("4")
        send(car = "different-vehicle"); assertGear("—")
        settle(); assertGear("4")
        send(age = 6000); assertGear("—")
        settle(); assertGear("4")
        send(rpm = 800, speed = 0f, throttle = 0); assertGear("—")
        settle(); assertGear("4")
        dispatch(Intent("com.example.obdapp.STATUS_UPDATE").setPackage(context.packageName)
            .putExtra("running", false))
        assertGear("—")
    }

    @Test fun untrustedSimulationAndVehicleProfileChangesCannotLeaveAGearBehind() {
        settle(); assertGear("4")
        send(action = "com.example.obdapp.MOCK_TELEMETRY"); assertGear("—")
        settle(); assertGear("4")
        scenario!!.onActivity { activity ->
            activity.findViewById<CheckBox>(R.id.cbAxiaGearEstimate).isChecked = false
            assertEquals(View.GONE, activity.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
                .findViewById<View>(R.id.throttleGearRow).visibility)
        }
        settle(); assertGear("—")
        assertFalse(GearEstimatePrefs.enabled(context, vehicle))
        val other = VehiclePrefs.addVehicle(context, "Offline second vehicle", null)
        VehiclePrefs.setActiveVehicle(context, other.id)
        scenario!!.recreate()
        scenario!!.onActivity { activity ->
            assertFalse(activity.findViewById<CheckBox>(R.id.cbAxiaGearEstimate).isChecked)
            assertEquals(View.GONE, activity.findViewById<TelemetryWidgetView>(R.id.widgetSlot2)
                .findViewById<View>(R.id.throttleGearRow).visibility)
        }
        assertFalse(OBDGatewayService.isRunning)
        VehiclePrefs.deleteVehicle(context, other.id)
        VehiclePrefs.setActiveVehicle(context, vehicle)
    }

    @Test fun constrainedCardsAndLargeFontsHideTheSupplementalGearRow() {
        scenario!!.onActivity {
            for ((fontScale, heightDp) in listOf(1f to 180, 2f to 368)) {
                val config = Configuration(context.resources.configuration).apply { this.fontScale = fontScale }
                val scaled = context.createConfigurationContext(config)
                val widget = TelemetryWidgetView(scaled)
                widget.bindMetric(TelemetryMetric.THROTTLE, DisplayStyle.BAR)
                widget.updateGearEstimate(4, true)
                val density = scaled.resources.displayMetrics.density
                val w = (382 * density).toInt()
                val h = (heightDp * density).toInt()
                widget.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
                widget.layout(0, 0, w, h)
                assertEquals(View.GONE, widget.findViewById<View>(R.id.throttleGearRow).visibility)
                assertTrue(widget.findViewById<View>(R.id.telemetryPrimaryContent).height > 0)
            }
        }
    }
}
