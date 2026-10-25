package com.example.obdapp

import android.view.ContextThemeWrapper
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 26])
class Api23SystemBarCompatibilityTest {
    @Test
    @Config(qualifiers = "notnight")
    fun lightModeKeepsNavigationSurfaceDarkWhenDarkIconsAreUnsupported() {
        val context = ContextThemeWrapper(ApplicationProvider.getApplicationContext(), R.style.Theme_OBDApp)
        val theme = context.theme
        val statusIcons = android.util.TypedValue()
        assertTrue(theme.resolveAttribute(android.R.attr.windowLightStatusBar, statusIcons, true))
        assertEquals(true, statusIcons.data != 0)
        assertEquals(0xFF0F1318.toInt(), resolvedColor(theme, android.R.attr.navigationBarColor))
    }

    @Test
    @Config(qualifiers = "night")
    fun darkModeKeepsLightNavigationIconsOnDarkSurface() {
        val context = ContextThemeWrapper(ApplicationProvider.getApplicationContext(), R.style.Theme_OBDApp)
        val theme = context.theme
        val statusIcons = android.util.TypedValue()
        assertTrue(theme.resolveAttribute(android.R.attr.windowLightStatusBar, statusIcons, true))
        assertEquals(false, statusIcons.data != 0)
        assertEquals(0xFF0F1318.toInt(), resolvedColor(theme, android.R.attr.navigationBarColor))
    }

    private fun resolvedColor(theme: android.content.res.Resources.Theme, attribute: Int): Int {
        val value = android.util.TypedValue()
        assertTrue(theme.resolveAttribute(attribute, value, true))
        return value.data
    }
}
