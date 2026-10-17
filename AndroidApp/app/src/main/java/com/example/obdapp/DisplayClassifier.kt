package com.example.obdapp

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.util.DisplayMetrics
import android.view.View
import android.view.WindowManager

/**
 * Screen Class taxonomy for automotive displays.
 * Accounts for firmware density spoofing common in aftermarket Android head units
 * (e.g., FYT/Unisoc 7862, Rockchip PX6, Allwinner T3/T5 hardcoded to 160 or 240 dpi)
 * by evaluating usable pixel dimensions, aspect ratio (AR), and usable vertical dp.
 */
enum class ScreenClass(val visibleSlotCount: Int) {
    /** 7" DIN (1024x600, 800x480): 1.35 <= AR < 2.15 and H_dp < 500dp */
    COMPACT_LAND(6),

    /** 10.25"–12.3" Panoramic (1920x720, 1600x600, 24:9): AR >= 2.15 */
    ULTRAWIDE_LAND(8),

    /** 13.3"–15.6" Tesla-Style Vertical (1080x1920, 1200x2000): AR < 1.35 */
    PORTRAIT_COCKPIT(10),

    /** 9"–15.6" FHD/QHD Landscape (1920x1080, 2000x1200): 1.35 <= AR < 2.15 and H_dp >= 500dp */
    EXPANSIVE_LAND(12)
}

data class DisplayInfo(
    val widthPx: Int,
    val heightPx: Int,
    val widthDp: Float,
    val heightDp: Float,
    val aspectRatio: Float,
    val screenClass: ScreenClass
)

object DisplayClassifier {

    /**
     * Classifies the display based on measured view bounds or window metrics.
     * @param usableWidthPx Usable pixel width (excluding window insets if applicable)
     * @param usableHeightPx Usable pixel height (excluding system header/bars)
     * @param densityDpi Device screen density in DPI (e.g. 160, 240, 320, 480)
     */
    fun classifyDimensions(usableWidthPx: Int, usableHeightPx: Int, densityDpi: Int): DisplayInfo {
        val safeW = usableWidthPx.coerceAtLeast(1)
        val safeH = usableHeightPx.coerceAtLeast(1)
        val densityFactor = (if (densityDpi > 0) densityDpi else 160) / 160f

        val widthDp = safeW / densityFactor
        val heightDp = safeH / densityFactor
        val ar = safeW.toFloat() / safeH.toFloat()

        val screenClass = when {
            // Portrait / Vertical Tesla-style screens
            ar < 1.35f -> ScreenClass.PORTRAIT_COCKPIT
            // Ultra-wide panoramic screens (1920x720, 1600x600, etc.)
            ar >= 2.15f -> ScreenClass.ULTRAWIDE_LAND
            // Compact standard landscape (7" DIN 1024x600, 800x480) with limited vertical dp or raw pixel ceiling (firmware 160dpi spoofing)
            heightDp < 500f || safeH <= 640 || safeW <= 1024 -> ScreenClass.COMPACT_LAND
            // Expansive widescreen landscape (1920x1080, 2000x1200, etc.)
            else -> ScreenClass.EXPANSIVE_LAND
        }

        return DisplayInfo(
            widthPx = safeW,
            heightPx = safeH,
            widthDp = widthDp,
            heightDp = heightDp,
            aspectRatio = ar,
            screenClass = screenClass
        )
    }

    /**
     * Evaluates display metrics directly from an Activity window with API 29 compatibility.
     */
    fun classifyActivity(activity: Activity): DisplayInfo {
        val wm = activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getMetrics(metrics)

        val widthPx: Int
        val heightPx: Int
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val windowMetrics = wm.currentWindowMetrics
            val insets = windowMetrics.windowInsets.getInsetsIgnoringVisibility(
                android.view.WindowInsets.Type.systemBars()
            )
            widthPx = windowMetrics.bounds.width() - insets.left - insets.right
            heightPx = windowMetrics.bounds.height() - insets.top - insets.bottom
        } else {
            widthPx = metrics.widthPixels
            heightPx = metrics.heightPixels
        }

        return classifyDimensions(widthPx, heightPx, metrics.densityDpi)
    }

    /**
     * Helper to classify a specific container View after it has been measured.
     */
    fun classifyView(view: View): DisplayInfo {
        val dm = view.resources.displayMetrics
        val w = if (view.width > 0) view.width else dm.widthPixels
        val h = if (view.height > 0) view.height else dm.heightPixels
        return classifyDimensions(w, h, dm.densityDpi)
    }
}
