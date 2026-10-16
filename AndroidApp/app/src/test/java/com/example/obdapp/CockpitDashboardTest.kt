package com.example.obdapp

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class CockpitDashboardTest {

    private lateinit var context: Context
    private lateinit var configManager: DashboardConfigManager

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences("DASHBOARD_PREFS", Context.MODE_PRIVATE).edit().clear().commit()
        configManager = DashboardConfigManager(context)
    }

    @Test
    fun defaultPresetIsSportWithCorrectSlots() {
        val preset = configManager.getActivePreset()
        assertEquals(DashboardPreset.SPORT, preset)

        val slots = configManager.getSlotConfigs(preset)
        assertEquals(12, slots.size)
        assertEquals(TelemetryMetric.SPEED, slots[0].metric)
        assertEquals(DisplayStyle.DIAL, slots[0].style)
        assertEquals(TelemetryMetric.RPM, slots[1].metric)
        assertEquals(DisplayStyle.DIAL, slots[1].style)
        assertEquals(TelemetryMetric.THROTTLE, slots[2].metric)
        assertEquals(DisplayStyle.BAR, slots[2].style)
    }

    @Test
    fun cruiserAndHealthPresetsHaveConfiguredDefaults() {
        val cruiserSlots = configManager.getSlotConfigs(DashboardPreset.CRUISER)
        assertEquals(12, cruiserSlots.size)
        assertEquals(TelemetryMetric.SPEED, cruiserSlots[0].metric)
        assertEquals(DisplayStyle.DIAL, cruiserSlots[0].style)
        assertEquals(TelemetryMetric.RPM, cruiserSlots[1].metric)
        assertEquals(DisplayStyle.DIAL, cruiserSlots[1].style)
        assertEquals(TelemetryMetric.FUEL_ECONOMY, cruiserSlots[6].metric)
        assertEquals(DisplayStyle.DIGITAL, cruiserSlots[6].style)

        val healthSlots = configManager.getSlotConfigs(DashboardPreset.HEALTH)
        assertEquals(12, healthSlots.size)
        assertEquals(TelemetryMetric.COOLANT, healthSlots[0].metric)
        assertEquals(DisplayStyle.DIAL, healthSlots[0].style)
        assertEquals(TelemetryMetric.BATTERY, healthSlots[1].metric)
        assertEquals(DisplayStyle.DIAL, healthSlots[1].style)
        assertEquals(TelemetryMetric.ENGINE_LOAD, healthSlots[2].metric)
        assertEquals(DisplayStyle.BAR, healthSlots[2].style)
    }

    @Test
    fun customSlotsArePersistedAndRetrieved() {
        configManager.saveCustomSlot(0, SlotConfig(TelemetryMetric.COOLANT, DisplayStyle.DIAL))
        configManager.saveCustomSlot(1, SlotConfig(TelemetryMetric.BATTERY, DisplayStyle.GRAPH))

        val loaded = configManager.loadCustomSlots()
        assertEquals(TelemetryMetric.COOLANT, loaded[0].metric)
        assertEquals(DisplayStyle.DIAL, loaded[0].style)
        assertEquals(TelemetryMetric.BATTERY, loaded[1].metric)
        assertEquals(DisplayStyle.GRAPH, loaded[1].style)
    }

    @Test
    fun telemetryWidgetViewBindsAndCyclesStyles() {
        val widget = TelemetryWidgetView(context)
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.DIAL)

        assertEquals(TelemetryMetric.SPEED, widget.currentMetric)
        assertEquals(DisplayStyle.DIAL, widget.currentStyle)

        // Cycle through all 4 formats
        widget.cycleStyle()
        assertEquals(DisplayStyle.BAR, widget.currentStyle)

        widget.cycleStyle()
        assertEquals(DisplayStyle.DIGITAL, widget.currentStyle)

        widget.cycleStyle()
        assertEquals(DisplayStyle.GRAPH, widget.currentStyle)

        widget.cycleStyle()
        assertEquals(DisplayStyle.DIAL, widget.currentStyle)
    }

    @Test
    fun circularGaugeClampsValuesAndTracksPeak() {
        val gauge = CircularGaugeView(context)
        gauge.minValue = 0f
        gauge.maxValue = 200f

        gauge.currentValue = 120f
        assertEquals(120f, gauge.currentValue)
        assertEquals(120f, gauge.peakValue)

        // Lower current value should not lower peak
        gauge.currentValue = 80f
        assertEquals(80f, gauge.currentValue)
        assertEquals(120f, gauge.peakValue)

        // Over-maximum value is clamped
        gauge.currentValue = 250f
        assertEquals(200f, gauge.currentValue)
    }

    @Test
    fun linearBarGaugeClampsValues() {
        val bar = LinearBarGaugeView(context)
        bar.minValue = 0f
        bar.maxValue = 120f

        bar.currentValue = 88f
        assertEquals(88f, bar.currentValue)

        bar.currentValue = -10f
        assertEquals(0f, bar.currentValue)

        bar.currentValue = 150f
        assertEquals(120f, bar.currentValue)
    }

    @Test
    fun saveAllCustomSlotsPreservesBaseSlotsWhenTransitioningToCustom() {
        val cruiserSlots = configManager.getSlotConfigs(DashboardPreset.CRUISER)
        configManager.saveAllCustomSlots(cruiserSlots)
        // Modify slot 0
        configManager.saveCustomSlot(0, SlotConfig(TelemetryMetric.COOLANT, DisplayStyle.DIAL))
        configManager.setActivePreset(DashboardPreset.CUSTOM)

        val customSlots = configManager.loadCustomSlots()
        assertEquals(12, customSlots.size)
        // Slot 0 is modified
        assertEquals(TelemetryMetric.COOLANT, customSlots[0].metric)
        assertEquals(DisplayStyle.DIAL, customSlots[0].style)
        // Slot 1 retains Cruiser's RPM
        assertEquals(cruiserSlots[1].metric, customSlots[1].metric)
        assertEquals(cruiserSlots[1].style, customSlots[1].style)
        // Slot 6 retains Cruiser's FUEL_ECONOMY
        assertEquals(TelemetryMetric.FUEL_ECONOMY, customSlots[6].metric)
        assertEquals(DisplayStyle.DIGITAL, customSlots[6].style)
    }

    @Test
    fun bindMetricResetsPeakValueToNewMetricMin() {
        val widget = TelemetryWidgetView(context)
        widget.bindMetric(TelemetryMetric.RPM, DisplayStyle.DIAL)
        widget.updateValue(6000.0)

        val dial = widget.findViewById<CircularGaugeView>(R.id.dialGaugeView)
        assertEquals(6000f, dial.peakValue)

        // Rebind to SPEED (maxVal 240, minVal 0)
        widget.bindMetric(TelemetryMetric.SPEED, DisplayStyle.DIAL)
        assertEquals(TelemetryMetric.SPEED.minVal, dial.peakValue)
        assertEquals(TelemetryMetric.SPEED.minVal, dial.currentValue)
    }

    @Test
    fun invertedAndStandardThresholdsEvaluateWithoutError() {
        val gauge = CircularGaugeView(context)
        gauge.minValue = 0f
        gauge.maxValue = 100f
        // Inverted: lower values are critical (e.g. Fuel Level: warn 15, crit 8)
        gauge.warningThreshold = 15f
        gauge.criticalThreshold = 8f

        // High fuel should be normal
        gauge.currentValue = 80f
        assertEquals(80f, gauge.currentValue)

        // Low fuel triggers warning/crit
        gauge.currentValue = 10f
        assertEquals(10f, gauge.currentValue)
        gauge.currentValue = 5f
        assertEquals(5f, gauge.currentValue)

        // Linear bar test with inverted threshold
        val bar = LinearBarGaugeView(context)
        bar.minValue = 0f
        bar.maxValue = 100f
        bar.warningThreshold = 15f
        bar.criticalThreshold = 8f
        bar.currentValue = 6f
        assertEquals(6f, bar.currentValue)

        // Standard threshold (warn < crit)
        bar.warningThreshold = 80f
        bar.criticalThreshold = 95f
        bar.currentValue = 90f
        assertEquals(90f, bar.currentValue)
    }

    @Test
    fun linearBarGaugeHandlesUnavailableState() {
        val bar = LinearBarGaugeView(context)
        bar.minValue = 0f
        bar.maxValue = 100f
        assertTrue(bar.isAvailable)

        bar.isAvailable = false
        org.junit.Assert.assertFalse(bar.isAvailable)

        bar.currentValue = 50f
        assertTrue(bar.isAvailable)
    }

    @Test
    fun telemetryWidgetViewHandlesNullAndUnavailableValues() {
        val widget = TelemetryWidgetView(context)
        widget.bindMetric(TelemetryMetric.FUEL_LEVEL, DisplayStyle.BAR)
        org.junit.Assert.assertFalse(widget.isMetricAvailable)

        val bar = widget.findViewById<LinearBarGaugeView>(R.id.barGaugeView)
        org.junit.Assert.assertFalse(bar.isAvailable)

        // Passing null keeps it unavailable
        widget.updateValue(null)
        org.junit.Assert.assertFalse(widget.isMetricAvailable)
        org.junit.Assert.assertFalse(bar.isAvailable)

        // Passing valid value makes it available
        widget.updateValue(45.0)
        assertTrue(widget.isMetricAvailable)
        assertTrue(bar.isAvailable)
        assertEquals(45f, bar.currentValue)
    }
}
