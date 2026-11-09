package com.example.obdapp.car

import android.graphics.Color
import android.graphics.Rect
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.example.obdapp.GatewayStatusStore
import com.example.obdapp.R
import com.example.obdapp.VehiclePrefs
import kotlinx.coroutines.*

/** Private read-only canvas. Sensor frames never invalidate or advance host task templates. */
internal class PersonalCockpitScreen(carContext: CarContext) : Screen(carContext) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val renderer = PersonalCockpitRenderer(carContext)
    private var refreshJob: Job? = null
    private var started = false
    private var container: SurfaceContainer? = null
    private var visible: Rect? = null
    private var stable: Rect? = null
    private var registrationFailed = false

    private val template by lazy {
        NavigationTemplate.Builder().setActionStrip(ActionStrip.Builder().addAction(
            Action.Builder().setTitle(carContext.getString(R.string.personal_cockpit_close))
                .setOnClickListener { carContext.finishCarApp() }.build()
        ).build()).build()
    }

    private val callback = object : SurfaceCallback {
        override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
            if (!started) { release(surfaceContainer.surface); return }
            val old = container
            if (old?.surface !== surfaceContainer.surface) release(old?.surface)
            if (old?.width != surfaceContainer.width || old?.height != surfaceContainer.height) {
                visible = null; stable = null
            }
            container = surfaceContainer
            drawFrame()
        }

        override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
            val owned = container?.surface
            container = null
            release(owned)
            if (surfaceContainer.surface !== owned) release(surfaceContainer.surface)
        }

        override fun onVisibleAreaChanged(visibleArea: Rect) {
            visible = visibleArea.takeUnless { it.isEmpty }?.let(::Rect)
            drawFrame()
        }

        override fun onStableAreaChanged(stableArea: Rect) {
            stable = stableArea.takeUnless { it.isEmpty }?.let(::Rect)
            drawFrame()
        }
    }

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                started = true
                try {
                    carContext.getCarService(AppManager::class.java).setSurfaceCallback(callback)
                    if (registrationFailed) {
                        registrationFailed = false
                        invalidate()
                    }
                } catch (error: RuntimeException) {
                    Log.w(TAG, "Host declined the personal cockpit surface", error)
                    registrationFailed = true
                    invalidate()
                    return
                }
                refreshJob?.cancel()
                refreshJob = scope.launch {
                    while (isActive) { drawFrame(); delay(500L) }
                }
            }

            override fun onStop(owner: LifecycleOwner) { stopFrames() }
            override fun onDestroy(owner: LifecycleOwner) { stopFrames(); scope.cancel() }
        })
    }

    override fun onGetTemplate(): Template = if (registrationFailed) {
        MessageTemplate.Builder(carContext.getString(R.string.personal_cockpit_unavailable))
            .setTitle("OBD Cockpit Personal").setHeaderAction(Action.APP_ICON).build()
    } else template

    private fun stopFrames() {
        started = false
        refreshJob?.cancel(); refreshJob = null
        try { carContext.getCarService(AppManager::class.java).setSurfaceCallback(null) }
        catch (error: RuntimeException) { Log.w(TAG, "Host surface already detached", error) }
        release(container?.surface); container = null
        visible = null; stable = null
    }

    private fun drawFrame() {
        if (!started) return
        val current = container ?: return
        val surface = current.surface ?: return
        if (!surface.isValid || current.width <= 0 || current.height <= 0 || current.dpi <= 0) return
        try {
            val canvas = surface.lockCanvas(null)
            try {
                canvas.drawColor(Color.BLACK)
                val viewport = viewport(current.width, current.height, visible, stable)
                if (!viewport.isEmpty) renderer.draw(canvas, viewport, current.dpi, GatewayStatusStore.status.value,
                    VehiclePrefs.getActiveVehicleId(carContext), SystemClock.elapsedRealtime())
            } finally { surface.unlockCanvasAndPost(canvas) }
        } catch (error: RuntimeException) {
            // A host may resize/destroy the buffer between validity and canvas acquisition.
            Log.w(TAG, "Cockpit frame skipped while the host surface changed", error)
        }
    }

    private fun release(surface: Surface?) {
        try { surface?.release() } catch (error: RuntimeException) { Log.w(TAG, "Unable to release host surface", error) }
    }

    companion object {
        private const val TAG = "PersonalCockpit"
        internal fun viewport(width: Int, height: Int, visible: Rect?, stable: Rect?): Rect {
            val result = Rect(0, 0, width.coerceAtLeast(0), height.coerceAtLeast(0))
            for (area in listOfNotNull(visible, stable).filterNot { it.isEmpty }) {
                if (!result.intersect(area)) return Rect()
            }
            return result
        }
    }
}
