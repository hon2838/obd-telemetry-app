package com.example.obdapp

import android.content.Context
import android.content.SharedPreferences

data class SlotConfig(
    val metric: TelemetryMetric,
    val style: DisplayStyle
)

enum class DashboardPreset(val displayName: String) {
    SPORT("Sport / Performance"),
    CRUISER("Cruiser / Economy"),
    HEALTH("Powertrain Health"),
    CUSTOM("Custom Layout")
}

class DashboardConfigManager(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences("DASHBOARD_PREFS", Context.MODE_PRIVATE)

    companion object {
        const val SLOT_COUNT = 12
        private const val KEY_ACTIVE_PRESET = "active_preset"

        val PRESET_SPORT_SLOTS = listOf(
            SlotConfig(TelemetryMetric.SPEED, DisplayStyle.DIAL),         // Slot 0 (Row 1 Left)
            SlotConfig(TelemetryMetric.RPM, DisplayStyle.DIAL),           // Slot 1 (Row 1 Right)
            SlotConfig(TelemetryMetric.THROTTLE, DisplayStyle.BAR),       // Slot 2 (Row 2 Col 1)
            SlotConfig(TelemetryMetric.ENGINE_LOAD, DisplayStyle.BAR),   // Slot 3 (Row 2 Col 2)
            SlotConfig(TelemetryMetric.COOLANT, DisplayStyle.BAR),       // Slot 4 (Row 2 Col 3)
            SlotConfig(TelemetryMetric.INTAKE_TEMP, DisplayStyle.BAR),   // Slot 5 (Row 2 Col 4)
            SlotConfig(TelemetryMetric.TIMING_ADVANCE, DisplayStyle.DIGITAL), // Slot 6 (Row 1 Center Top)
            SlotConfig(TelemetryMetric.FUEL_RATE, DisplayStyle.DIGITAL),      // Slot 7 (Row 1 Center Bottom)
            SlotConfig(TelemetryMetric.BATTERY, DisplayStyle.DIGITAL),   // Slot 8 (Row 3 Col 1)
            SlotConfig(TelemetryMetric.MANIFOLD_PRESSURE, DisplayStyle.BAR), // Slot 9 (Row 3 Col 2)
            SlotConfig(TelemetryMetric.MASS_AIR_FLOW, DisplayStyle.DIGITAL), // Slot 10 (Row 3 Col 3)
            SlotConfig(TelemetryMetric.FUEL_ECONOMY, DisplayStyle.DIGITAL)   // Slot 11 (Row 3 Col 4)
        )

        val PRESET_CRUISER_SLOTS = listOf(
            SlotConfig(TelemetryMetric.SPEED, DisplayStyle.DIAL),         // Slot 0
            SlotConfig(TelemetryMetric.RPM, DisplayStyle.DIAL),           // Slot 1
            SlotConfig(TelemetryMetric.THROTTLE, DisplayStyle.BAR),       // Slot 2
            SlotConfig(TelemetryMetric.ENGINE_LOAD, DisplayStyle.BAR),   // Slot 3
            SlotConfig(TelemetryMetric.COOLANT, DisplayStyle.BAR),       // Slot 4
            SlotConfig(TelemetryMetric.BATTERY, DisplayStyle.BAR),       // Slot 5
            SlotConfig(TelemetryMetric.FUEL_ECONOMY, DisplayStyle.DIGITAL), // Slot 6
            SlotConfig(TelemetryMetric.FUEL_RATE, DisplayStyle.DIGITAL),    // Slot 7
            SlotConfig(TelemetryMetric.FUEL_LEVEL, DisplayStyle.BAR),     // Slot 8
            SlotConfig(TelemetryMetric.INTAKE_TEMP, DisplayStyle.BAR),   // Slot 9
            SlotConfig(TelemetryMetric.MASS_AIR_FLOW, DisplayStyle.DIGITAL), // Slot 10
            SlotConfig(TelemetryMetric.GPS_ALTITUDE, DisplayStyle.DIGITAL)   // Slot 11
        )

        val PRESET_HEALTH_SLOTS = listOf(
            SlotConfig(TelemetryMetric.COOLANT, DisplayStyle.DIAL),       // Slot 0
            SlotConfig(TelemetryMetric.BATTERY, DisplayStyle.DIAL),       // Slot 1
            SlotConfig(TelemetryMetric.ENGINE_LOAD, DisplayStyle.BAR),   // Slot 2
            SlotConfig(TelemetryMetric.THROTTLE, DisplayStyle.BAR),      // Slot 3
            SlotConfig(TelemetryMetric.INTAKE_TEMP, DisplayStyle.BAR),   // Slot 4
            SlotConfig(TelemetryMetric.MANIFOLD_PRESSURE, DisplayStyle.BAR), // Slot 5
            SlotConfig(TelemetryMetric.TIMING_ADVANCE, DisplayStyle.DIGITAL), // Slot 6
            SlotConfig(TelemetryMetric.MASS_AIR_FLOW, DisplayStyle.DIGITAL),  // Slot 7
            SlotConfig(TelemetryMetric.SPEED, DisplayStyle.DIGITAL),      // Slot 8
            SlotConfig(TelemetryMetric.RPM, DisplayStyle.DIGITAL),        // Slot 9
            SlotConfig(TelemetryMetric.FUEL_RATE, DisplayStyle.DIGITAL),  // Slot 10
            SlotConfig(TelemetryMetric.FUEL_LEVEL, DisplayStyle.BAR)      // Slot 11
        )
    }

    fun getActivePreset(): DashboardPreset {
        val name = prefs.getString(KEY_ACTIVE_PRESET, DashboardPreset.SPORT.name)
        return try {
            DashboardPreset.valueOf(name ?: DashboardPreset.SPORT.name)
        } catch (_: Exception) {
            DashboardPreset.SPORT
        }
    }

    fun setActivePreset(preset: DashboardPreset) {
        prefs.edit().putString(KEY_ACTIVE_PRESET, preset.name).apply()
    }

    fun getSlotConfigs(preset: DashboardPreset): List<SlotConfig> {
        return when (preset) {
            DashboardPreset.SPORT -> PRESET_SPORT_SLOTS
            DashboardPreset.CRUISER -> PRESET_CRUISER_SLOTS
            DashboardPreset.HEALTH -> PRESET_HEALTH_SLOTS
            DashboardPreset.CUSTOM -> loadCustomSlots()
        }
    }

    fun saveCustomSlot(slotIndex: Int, config: SlotConfig) {
        prefs.edit()
            .putString("slot_${slotIndex}_metric", config.metric.name)
            .putString("slot_${slotIndex}_style", config.style.name)
            .apply()
    }

    fun saveAllCustomSlots(configs: List<SlotConfig>) {
        val editor = prefs.edit()
        configs.forEachIndexed { index, config ->
            if (index < SLOT_COUNT) {
                editor.putString("slot_${index}_metric", config.metric.name)
                editor.putString("slot_${index}_style", config.style.name)
            }
        }
        editor.apply()
    }

    fun loadCustomSlots(): List<SlotConfig> {
        val list = mutableListOf<SlotConfig>()
        for (i in 0 until SLOT_COUNT) {
            val metricName = prefs.getString("slot_${i}_metric", null)
            val styleName = prefs.getString("slot_${i}_style", null)

            val metric = if (metricName != null) {
                try { TelemetryMetric.valueOf(metricName) } catch (_: Exception) { PRESET_SPORT_SLOTS[i].metric }
            } else {
                PRESET_SPORT_SLOTS[i].metric
            }

            val style = if (styleName != null) {
                try { DisplayStyle.valueOf(styleName) } catch (_: Exception) { PRESET_SPORT_SLOTS[i].style }
            } else {
                PRESET_SPORT_SLOTS[i].style
            }

            list.add(SlotConfig(metric, style))
        }
        return list
    }
}
