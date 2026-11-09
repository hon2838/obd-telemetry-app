package com.example.obdapp.car

import android.content.Context
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.os.Looper
import android.view.Surface
import androidx.car.app.AppManager
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.MessageTemplate
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestAppManager
import androidx.car.app.testing.TestCarContext
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ApplicationProvider
import com.example.obdapp.GatewayStatusStore
import com.example.obdapp.LiveGaugeSnapshot
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
class PersonalCockpitScreenTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    @After fun cleanup() { GatewayStatusStore.setRunning(false) }

    @Test fun liveFramesKeepOneTemplateAndStopDetachesTheCallback() {
        val car = TestCarContext.createCarContext(context)
        val manager = car.getCarService(AppManager::class.java) as TestAppManager
        val screen = PersonalCockpitScreen(car)
        val controller = ScreenController(screen).moveToState(Lifecycle.State.RESUMED)
        try {
            shadowOf(Looper.getMainLooper()).idle()
            assertNotNull(manager.surfaceCallback)
            val template = screen.onGetTemplate()
            assertTrue(template is NavigationTemplate)
            assertFalse(template is MessageTemplate)
            repeat(12) { n ->
                GatewayStatusStore.recordSample("default", true, null, 1000L + n,
                    LiveGaugeSnapshot(speedKmh = 40f + n, sampledAtElapsedMs = 1000L + n))
                shadowOf(Looper.getMainLooper()).idleFor(500, TimeUnit.MILLISECONDS)
                assertSame(template, screen.onGetTemplate())
            }
            controller.moveToState(Lifecycle.State.CREATED)
            assertNull(manager.surfaceCallback)
            controller.reset()
            shadowOf(Looper.getMainLooper()).idleFor(2, TimeUnit.SECONDS)
            assertTrue(controller.templatesReturned.isEmpty())
            controller.moveToState(Lifecycle.State.RESUMED)
            shadowOf(Looper.getMainLooper()).idle()
            assertNotNull(manager.surfaceCallback)
        } finally { controller.moveToState(Lifecycle.State.DESTROYED) }
        assertNull(manager.surfaceCallback)
    }

    @Test fun surfacesReceivedWhileStoppedAreReleasedWithoutStartingWork() {
        val car = TestCarContext.createCarContext(context)
        val manager = car.getCarService(AppManager::class.java) as TestAppManager
        val controller = ScreenController(PersonalCockpitScreen(car)).moveToState(Lifecycle.State.RESUMED)
        shadowOf(Looper.getMainLooper()).idle()
        val callback = manager.surfaceCallback!!
        controller.moveToState(Lifecycle.State.CREATED)
        val texture = SurfaceTexture(0)
        val surface = Surface(texture)
        try {
            assertTrue(surface.isValid)
            callback.onSurfaceAvailable(SurfaceContainer(surface, 1280, 720, 160))
            assertFalse(surface.isValid)
        } finally { surface.release(); texture.release(); controller.moveToState(Lifecycle.State.DESTROYED) }
    }

    @Test fun replacementAndDestroyedSurfacesReleaseTheirClientReferences() {
        val car = TestCarContext.createCarContext(context)
        val manager = car.getCarService(AppManager::class.java) as TestAppManager
        val controller = ScreenController(PersonalCockpitScreen(car)).moveToState(Lifecycle.State.RESUMED)
        shadowOf(Looper.getMainLooper()).idle()
        val callback = manager.surfaceCallback!!
        val firstTexture = SurfaceTexture(0); val secondTexture = SurfaceTexture(0)
        val first = Surface(firstTexture); val second = Surface(secondTexture)
        try {
            assertTrue(first.isValid)
            assertTrue(second.isValid)
            // Not-ready dimensions avoid actual buffer drawing in a JVM lifecycle test.
            callback.onSurfaceAvailable(SurfaceContainer(first, 0, 0, 160))
            callback.onSurfaceAvailable(SurfaceContainer(second, 0, 0, 160))
            assertFalse(first.isValid)
            callback.onSurfaceDestroyed(SurfaceContainer(second, 0, 0, 160))
            assertFalse(second.isValid)
        } finally {
            first.release(); second.release(); firstTexture.release(); secondTexture.release()
            controller.moveToState(Lifecycle.State.DESTROYED)
        }
    }

    @Test fun occludedAndOutOfBoundsAreasCannotExposeContentOutsideTheHostViewport() {
        assertEquals(Rect(30, 40, 900, 640), PersonalCockpitScreen.viewport(1000, 700,
            Rect(-20, 20, 1100, 800), Rect(30, 40, 900, 640)))
        assertEquals(Rect(0, 0, 1000, 700), PersonalCockpitScreen.viewport(1000, 700, Rect(), null))
        assertTrue(PersonalCockpitScreen.viewport(1000, 700, Rect(1100, 0, 1200, 100), null).isEmpty)
        assertTrue(PersonalCockpitScreen.viewport(0, 0, null, null).isEmpty)
    }
}
