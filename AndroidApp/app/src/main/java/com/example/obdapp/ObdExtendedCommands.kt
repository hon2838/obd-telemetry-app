package com.example.obdapp

import com.github.eltonvs.obd.command.ObdCommand
import com.github.eltonvs.obd.command.ObdRawResponse

/**
 * Standard OBD-II Mode 01 commands for extended vehicle parameters.
 */
object ObdExtendedCommands {

    class EngineLoadCommand : ObdCommand() {
        override val tag = "ENGINE_LOAD"
        override val name = "Engine Load"
        override val mode = "01"
        override val pid = "04"
        override val defaultUnit = "%"
        override val handler = { response: ObdRawResponse ->
            val value = parsePercentage(response.value)
            "%.1f".format(java.util.Locale.US, value)
        }
    }

    class IntakeAirTempCommand : ObdCommand() {
        override val tag = "INTAKE_AIR_TEMP"
        override val name = "Intake Air Temperature"
        override val mode = "01"
        override val pid = "0F"
        override val defaultUnit = "°C"
        override val handler = { response: ObdRawResponse ->
            val temp = parseTemperature(response.value)
            temp.toString()
        }
    }

    class TimingAdvanceCommand : ObdCommand() {
        override val tag = "TIMING_ADVANCE"
        override val name = "Timing Advance"
        override val mode = "01"
        override val pid = "0E"
        override val defaultUnit = "°"
        override val handler = { response: ObdRawResponse ->
            val adv = parseTimingAdvance(response.value)
            "%.1f".format(java.util.Locale.US, adv)
        }
    }

    class FuelLevelCommand : ObdCommand() {
        override val tag = "FUEL_LEVEL"
        override val name = "Fuel Tank Level Input"
        override val mode = "01"
        override val pid = "2F"
        override val defaultUnit = "%"
        override val handler = { response: ObdRawResponse ->
            val value = parsePercentage(response.value)
            "%.1f".format(java.util.Locale.US, value)
        }
    }

    class BarometricPressureCommand : ObdCommand() {
        override val tag = "BAROMETRIC_PRESSURE"
        override val name = "Barometric Pressure"
        override val mode = "01"
        override val pid = "33"
        override val defaultUnit = "kPa"
        override val handler = { response: ObdRawResponse ->
            val value = parseBarometricPressure(response.value)
            value.toString()
        }
    }

    class ControlModuleVoltageCommand : ObdCommand() {
        override val tag = "CONTROL_MODULE_VOLTAGE"
        override val name = "Control Module Voltage"
        override val mode = "01"
        override val pid = "42"
        override val defaultUnit = "V"
        override val handler = { response: ObdRawResponse ->
            val v = parseControlModuleVoltage(response.value)
            "%.2f".format(java.util.Locale.US, v)
        }
    }

    fun parsePercentage(raw: String): Double {
        val bytes = cleanHexBytes(raw)
        if (bytes.isEmpty()) return 0.0
        val a = bytes[0].toIntOrNull(16) ?: 0
        return (a * 100.0) / 255.0
    }

    fun parseTemperature(raw: String): Int {
        val bytes = cleanHexBytes(raw)
        if (bytes.isEmpty()) return 0
        val a = bytes[0].toIntOrNull(16) ?: 0
        return a - 40
    }

    fun parseTimingAdvance(raw: String): Double {
        val bytes = cleanHexBytes(raw)
        if (bytes.isEmpty()) return 0.0
        val a = bytes[0].toIntOrNull(16) ?: 0
        return (a - 128) / 2.0
    }

    fun parseBarometricPressure(raw: String): Int {
        val bytes = cleanHexBytes(raw)
        if (bytes.isEmpty()) return 0
        return bytes[0].toIntOrNull(16) ?: 0
    }

    fun parseControlModuleVoltage(raw: String): Double {
        val bytes = cleanHexBytes(raw)
        if (bytes.size < 2) return 0.0
        val a = bytes[0].toIntOrNull(16) ?: 0
        val b = bytes[1].toIntOrNull(16) ?: 0
        return ((256 * a) + b) / 1000.0
    }

    private fun cleanHexBytes(raw: String): List<String> {
        val clean = raw.replace("41 ", "")
            .replace("SEARCHING...", "")
            .replace("STOPPED", "")
            .trim()
        val tokens = clean.split("\\s+".toRegex()).filter { it.isNotBlank() }
        val pidTokens = setOf("04", "0F", "0E", "2F", "33", "42", "11", "05", "10")
        val filtered = if (tokens.isNotEmpty() && pidTokens.contains(tokens[0].uppercase())) {
            tokens.drop(1)
        } else {
            tokens
        }
        return filtered
    }
}
