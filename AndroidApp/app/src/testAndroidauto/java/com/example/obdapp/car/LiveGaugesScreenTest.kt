package com.example.obdapp.car

import android.content.Context
import android.os.Looper
import android.os.SystemClock
import androidx.car.app.model.Action
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestCarContext
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ApplicationProvider
import com.example.obdapp.GatewayStatusStore
import com.example.obdapp.LiveGaugeSnapshot
import com.example.obdapp.PREFS_NAME
import com.example.obdapp.R
import com.example.obdapp.saveDeviceToken
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@LooperMode(LooperMode.Mode.PAUSED)
class LiveGaugesScreenTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @After fun clear() {
        GatewayStatusStore.setRunning(false)
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun liveGaugesScreenRendersSixGridItems() {
        saveDeviceToken(context, "obd_dev_local_test_fixture")
        val now = SystemClock.elapsedRealtime()
        val snapshot = LiveGaugeSnapshot(
            speedKmh = 55.4f,
            speedSource = "GPS",
            rpm = 1800,
            coolantTemp = 88,
            voltage = 14.1f,
            fuelRateLph = null,
            fuelEconomyKmL = 16.2,
            engineLoad = 35,
            sampledAtElapsedMs = now
        )
        GatewayStatusStore.recordSample("default", true, now, now, snapshot)

        val carContext = TestCarContext.createCarContext(context)
        val screen = LiveGaugesScreen(carContext)
        val template = screen.onGetTemplate() as GridTemplate

        assertEquals(carContext.getString(R.string.car_gauges_title), template.title.toString())
        assertEquals(Action.BACK, template.headerAction)

        val items = template.singleList?.items ?: emptyList()
        assertEquals(6, items.size)

        val speedItem = items[0] as GridItem
        assertEquals("Speed", speedItem.title.toString())
        assertEquals("55 km/h · GPS", speedItem.text.toString())
        assertTrue(speedItem.text.toString().contains("GPS"))

        val rpmItem = items[1] as GridItem
        assertEquals("Engine RPM", rpmItem.title.toString())
        assertEquals("1800 RPM", rpmItem.text.toString())

        val coolantItem = items[2] as GridItem
        assertEquals("Coolant Temp", coolantItem.title.toString())
        assertEquals("88 °C", coolantItem.text.toString())

        val voltItem = items[3] as GridItem
        assertEquals("Battery Voltage", voltItem.title.toString())
        assertEquals("14.1 V", voltItem.text.toString())

        val fuelItem = items[4] as GridItem
        assertEquals("Fuel", fuelItem.title.toString())
        assertEquals("16.2 km/L", fuelItem.text.toString())
        assertTrue(fuelItem.text.toString().contains("km/L"))

        val loadItem = items[5] as GridItem
        assertEquals("Engine Load", loadItem.title.toString())
        assertEquals("35 %", loadItem.text.toString())
    }

    @Test fun liveGaugesScreenRefreshesAtOneSecondIntervalsWhenResumed() {
        saveDeviceToken(context, "obd_dev_local_test_fixture")
        val carContext = TestCarContext.createCarContext(context)
        val screen = LiveGaugesScreen(carContext)
        val controller = ScreenController(screen).moveToState(Lifecycle.State.RESUMED)

        try {
            shadowOf(Looper.getMainLooper()).idle()
            val initial = controller.templatesReturned.last() as GridTemplate
            val initialSpeed = (initial.singleList?.items?.get(0) as GridItem).text.toString()
            assertEquals("--", initialSpeed)

            val now = SystemClock.elapsedRealtime()
            GatewayStatusStore.recordSample(
                "default", true, now, now,
                LiveGaugeSnapshot(speedKmh = 72f, speedSource = "OBD", sampledAtElapsedMs = now)
            )

            // Idle for 1.2s to trigger 1-second refresh ticker
            shadowOf(Looper.getMainLooper()).idleFor(1200, TimeUnit.MILLISECONDS)
            val updated = controller.templatesReturned.last() as GridTemplate
            val updatedSpeed = (updated.singleList?.items?.get(0) as GridItem).text.toString()
            assertEquals("72 km/h · OBD", updatedSpeed)
        } finally {
            controller.moveToState(Lifecycle.State.DESTROYED)
        }
    }

    @Test fun changingValuesUnitsAndAvailabilityRemainGridRefreshes() {
        val carContext = TestCarContext.createCarContext(context)
        val screen = LiveGaugesScreen(carContext)
        val now = SystemClock.elapsedRealtime()
        val snapshots = (50..61).map { speed -> LiveGaugeSnapshot(
            speedKmh = speed.toFloat(), speedSource = if (speed % 2 == 0) "OBD" else "GPS",
            rpm = 1800 + speed, fuelRateLph = 4.0, fuelEconomyKmL = 15.0,
            sampledAtElapsedMs = now)
        } + listOf(LiveGaugeSnapshot(speedKmh = 0f, fuelRateLph = 0.9, sampledAtElapsedMs = now),
            LiveGaugeSnapshot(sampledAtElapsedMs = now),
            LiveGaugeSnapshot(sampledAtElapsedMs = now - 16_000L))
        val templates = snapshots.map { snapshot ->
            GatewayStatusStore.recordSample("default", true, null, now, snapshot)
            screen.onGetTemplate() as GridTemplate
        }
        val titles = templates.first().singleList!!.items.map { (it as GridItem).title.toString() }
        for (template in templates) {
            assertEquals(templates.first().title, template.title)
            assertEquals(6, template.singleList!!.items.size)
            assertEquals(titles, template.singleList!!.items.map { (it as GridItem).title.toString() })
        }
        assertTrue(templates.map { (it.singleList!!.items[0] as GridItem).text.toString() }.distinct().size >= 12)
        assertEquals("0.9 L/h", (templates[12].singleList!!.items[4] as GridItem).text.toString())
        assertEquals("--", (templates.last().singleList!!.items[0] as GridItem).text.toString())
    }

    @Test fun liveGaugesScreenStopsPollingWhenStopped() {
        saveDeviceToken(context, "obd_dev_local_test_fixture")
        val carContext = TestCarContext.createCarContext(context)
        val screen = LiveGaugesScreen(carContext)
        val controller = ScreenController(screen).moveToState(Lifecycle.State.RESUMED)

        try {
            shadowOf(Looper.getMainLooper()).idle()
            controller.moveToState(Lifecycle.State.CREATED)
            controller.reset()

            val now = SystemClock.elapsedRealtime()
            GatewayStatusStore.recordSample(
                "default", true, now, now,
                LiveGaugeSnapshot(speedKmh = 80f, sampledAtElapsedMs = now)
            )

            shadowOf(Looper.getMainLooper()).idleFor(2, TimeUnit.SECONDS)
            assertTrue("Screen must not produce templates while stopped", controller.templatesReturned.isEmpty())
        } finally {
            controller.moveToState(Lifecycle.State.DESTROYED)
        }
    }
}
