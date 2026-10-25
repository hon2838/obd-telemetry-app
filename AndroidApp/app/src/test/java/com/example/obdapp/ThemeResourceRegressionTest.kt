package com.example.obdapp

import android.graphics.drawable.GradientDrawable
import android.view.ContextThemeWrapper
import android.view.LayoutInflater
import android.widget.Button
import android.widget.LinearLayout
import androidx.test.core.app.ApplicationProvider
import com.example.obdapp.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class ThemeResourceRegressionTest {
    @Test
    @Config(qualifiers = "notnight")
    fun lightThemeUsesDarkSystemBarIconsAndLightSurfaces() {
        val context = ContextThemeWrapper(ApplicationProvider.getApplicationContext(), R.style.Theme_OBDApp)
        val theme = context.theme
        val status = android.util.TypedValue()
        assertTrue(theme.resolveAttribute(android.R.attr.windowLightStatusBar, status, true))
        assertEquals(true, status.data != 0)
        assertEquals(0xFFFFFFFF.toInt(), context.getColor(R.color.header_bg))
        val expectedNavigation = if (android.os.Build.VERSION.SDK_INT >= 27) 0xFFF3F5F8.toInt() else 0xFF0F1318.toInt()
        assertEquals(expectedNavigation, context.getColor(R.color.navigation_bar_color))
        val statusColor = android.util.TypedValue()
        assertTrue(theme.resolveAttribute(android.R.attr.statusBarColor, statusColor, true))
        assertEquals(context.getColor(R.color.header_bg), statusColor.data)
        val navigationColor = android.util.TypedValue()
        assertTrue(theme.resolveAttribute(android.R.attr.navigationBarColor, navigationColor, true))
        assertEquals(expectedNavigation, navigationColor.data)

        if (android.os.Build.VERSION.SDK_INT >= 27) {
            val navigation = android.util.TypedValue()
            assertTrue(theme.resolveAttribute(android.R.attr.windowLightNavigationBar, navigation, true))
            assertEquals(true, navigation.data != 0)
        }
    }

    @Test
    @Config(qualifiers = "night")
    fun darkThemeUsesLightSystemBarIconsAndDarkSurfaces() {
        val context = ContextThemeWrapper(ApplicationProvider.getApplicationContext(), R.style.Theme_OBDApp)
        val status = android.util.TypedValue()
        assertTrue(context.theme.resolveAttribute(android.R.attr.windowLightStatusBar, status, true))
        assertEquals(false, status.data != 0)
        assertEquals(0xFF131820.toInt(), context.getColor(R.color.header_bg))
        assertEquals(0xFF0F1318.toInt(), context.getColor(R.color.navigation_bar_color))
        val statusColor = android.util.TypedValue()
        assertTrue(context.theme.resolveAttribute(android.R.attr.statusBarColor, statusColor, true))
        assertEquals(context.getColor(R.color.header_bg), statusColor.data)
        val navigationColor = android.util.TypedValue()
        assertTrue(context.theme.resolveAttribute(android.R.attr.navigationBarColor, navigationColor, true))
        assertEquals(context.getColor(R.color.navigation_bar_color), navigationColor.data)

        if (android.os.Build.VERSION.SDK_INT >= 27) {
            val navigation = android.util.TypedValue()
            assertTrue(context.theme.resolveAttribute(android.R.attr.windowLightNavigationBar, navigation, true))
            assertEquals(false, navigation.data != 0)
        }
    }

    @Test
    @Config(sdk = [29], qualifiers = "night")
    fun actualStopButtonForegroundMeetsNormalTextContrast() {
        val context = ContextThemeWrapper(ApplicationProvider.getApplicationContext(), R.style.Theme_OBDApp)
        val parent = LinearLayout(context)
        LayoutInflater.from(context).inflate(R.layout.view_status_card, parent, true)
        val stop = parent.findViewById<Button>(R.id.btnStop)
        val fill = (stop.background as GradientDrawable).color!!.defaultColor
        val text = stop.textColors.defaultColor
        assertEquals(context.getColor(R.color.danger_button_bg), fill)
        assertEquals(context.getColor(R.color.danger_button_text), text)
        assertTrue("Stop label contrast was ${contrast(text, fill)}", contrast(text, fill) >= 4.5)

        val diagnostics = LinearLayout(context)
        LayoutInflater.from(context).inflate(R.layout.activity_diagnostics, diagnostics, true)
        val read = diagnostics.findViewById<android.widget.TextView>(R.id.btnReadDtc)
        val readFill = (read.background as GradientDrawable).color!!.defaultColor
        assertEquals(context.getColor(R.color.btn_secondary_bg), readFill)
        assertEquals(context.getColor(R.color.btn_secondary_text), read.currentTextColor)
        assertTrue("Read Codes label contrast was ${contrast(read.currentTextColor, readFill)}", contrast(read.currentTextColor, readFill) >= 4.5)
        val clear = diagnostics.findViewById<android.widget.TextView>(R.id.btnClearDtc)
        val clearFill = (clear.background as GradientDrawable).color!!.defaultColor
        assertEquals(context.getColor(R.color.danger_button_bg), clearFill)
        assertEquals(context.getColor(R.color.danger_button_text), clear.currentTextColor)
        assertTrue("Clear Codes label contrast was ${contrast(clear.currentTextColor, clearFill)}", contrast(clear.currentTextColor, clearFill) >= 4.5)
    }

    @Test
    @Config(sdk = [29], qualifiers = "night")
    fun darkSemanticTextAccentsRemainReadableOnCardSurfaces() {
        val context = ContextThemeWrapper(ApplicationProvider.getApplicationContext(), R.style.Theme_OBDApp)
        val surfaces = listOf(R.color.card, R.color.card_elevated)
        for (accent in listOf(R.color.accent_red_text, R.color.accent_green_text)) {
            for (surface in surfaces) {
                val ratio = contrast(context.getColor(accent), context.getColor(surface))
                assertTrue("Accent $accent on surface $surface contrast was $ratio", ratio >= 4.5)
            }
        }
    }

    private fun contrast(foreground: Int, background: Int): Double {
        fun luminance(color: Int): Double {
            fun channel(value: Int): Double {
                val normalized = value / 255.0
                return if (normalized <= 0.04045) normalized / 12.92 else Math.pow((normalized + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * channel(android.graphics.Color.red(color)) +
                0.7152 * channel(android.graphics.Color.green(color)) +
                0.0722 * channel(android.graphics.Color.blue(color))
        }
        val a = luminance(foreground)
        val b = luminance(background)
        return (maxOf(a, b) + 0.05) / (minOf(a, b) + 0.05)
    }
}
