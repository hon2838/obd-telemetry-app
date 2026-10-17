package com.example.obdapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DisplayClassifierTest {

    @Test
    fun classifiesCompactLandFor7InchScreens() {
        // 7" 1024x600 with 240 dpi -> h_dp = 400dp (< 500dp), ar = 1.706
        val info = DisplayClassifier.classifyDimensions(1024, 600, 240)
        assertEquals(ScreenClass.COMPACT_LAND, info.screenClass)
        assertEquals(6, info.screenClass.visibleSlotCount)
        assertTrue(info.heightDp < 500f)
        assertTrue(info.aspectRatio in 1.35f..2.15f)

        // 7" 800x480 with 160 dpi -> h_dp = 480dp (< 500dp), ar = 1.66
        val info800 = DisplayClassifier.classifyDimensions(800, 480, 160)
        assertEquals(ScreenClass.COMPACT_LAND, info800.screenClass)
        assertEquals(6, info800.screenClass.visibleSlotCount)

        // 7" 1024x600 with firmware spoofed to 160 dpi (densityFactor = 1.0)
        // safeH = 600px -> 600dp, raw safeW <= 1024 / safeH <= 640 must catch it!
        val infoSpoofed = DisplayClassifier.classifyDimensions(1024, 600, 160)
        assertEquals(ScreenClass.COMPACT_LAND, infoSpoofed.screenClass)
        assertEquals(6, infoSpoofed.screenClass.visibleSlotCount)

        // 7" 1024x600 after 48dp cockpit header -> safeW = 1024, safeH = 552 at 160 dpi
        val infoHeader = DisplayClassifier.classifyDimensions(1024, 552, 160)
        assertEquals(ScreenClass.COMPACT_LAND, infoHeader.screenClass)
        assertEquals(6, infoHeader.screenClass.visibleSlotCount)
    }

    @Test
    fun classifiesUltraWideLandForPanoramicScreens() {
        // 10.25" / 12.3" 1920x720 -> ar = 2.666 (>= 2.15)
        val info = DisplayClassifier.classifyDimensions(1920, 720, 213)
        assertEquals(ScreenClass.ULTRAWIDE_LAND, info.screenClass)
        assertEquals(8, info.screenClass.visibleSlotCount)
        assertTrue(info.aspectRatio >= 2.15f)

        // 1600x600 -> ar = 2.666 (>= 2.15)
        val info1600 = DisplayClassifier.classifyDimensions(1600, 600, 160)
        assertEquals(ScreenClass.ULTRAWIDE_LAND, info1600.screenClass)
        assertEquals(8, info1600.screenClass.visibleSlotCount)
    }

    @Test
    fun classifiesPortraitCockpitForTeslaStyleScreens() {
        // 1080x1920 portrait -> ar = 0.5625 (< 1.35)
        val info = DisplayClassifier.classifyDimensions(1080, 1920, 320)
        assertEquals(ScreenClass.PORTRAIT_COCKPIT, info.screenClass)
        assertEquals(10, info.screenClass.visibleSlotCount)
        assertTrue(info.aspectRatio < 1.35f)

        // 1200x2000 portrait -> ar = 0.60 (< 1.35)
        val info1200 = DisplayClassifier.classifyDimensions(1200, 2000, 320)
        assertEquals(ScreenClass.PORTRAIT_COCKPIT, info1200.screenClass)
        assertEquals(10, info1200.screenClass.visibleSlotCount)
    }

    @Test
    fun classifiesExpansiveLandForLargeWidescreens() {
        // 10.1" / 15.6" 1920x1080 with 240 dpi -> h_dp = 720dp (>= 500dp), ar = 1.777
        val info = DisplayClassifier.classifyDimensions(1920, 1080, 240)
        assertEquals(ScreenClass.EXPANSIVE_LAND, info.screenClass)
        assertEquals(12, info.screenClass.visibleSlotCount)
        assertTrue(info.heightDp >= 500f)
        assertTrue(info.aspectRatio in 1.35f..2.15f)
    }
}
