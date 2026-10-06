package com.example.obdapp

import org.junit.Assert.*
import org.junit.Test

class ObdCapabilitiesTest {

    @Test
    fun parsesFirstBitmaskCorrectly() {
        val pids = ObdCapabilities.parseMask("41 00 BE 3F B8 13")
        assertTrue(pids.contains(0x01)) // Status since DTCs cleared
        assertFalse(pids.contains(0x02)) // Freeze DTC
        assertTrue(pids.contains(0x04)) // Calculated engine load
        assertTrue(pids.contains(0x05)) // Engine coolant temperature
        assertTrue(pids.contains(0x0B)) // Intake manifold absolute pressure
        assertTrue(pids.contains(0x0C)) // Engine RPM
        assertTrue(pids.contains(0x0D)) // Vehicle speed
        assertTrue(pids.contains(0x0E)) // Timing advance
        assertTrue(pids.contains(0x0F)) // Intake air temperature
        assertTrue(pids.contains(0x10)) // MAF air flow rate
        assertTrue(pids.contains(0x11)) // Throttle position
        assertTrue(pids.contains(0x20)) // PIDs supported [21 - 40]
    }

    @Test
    fun parsesSecondBitmaskAndIdentifiesUnsupportedFuelLevel() {
        val pids = ObdCapabilities.parseMask("41 20 80 04 20 01")
        assertTrue(pids.contains(0x21)) // Distance traveled with MIL on
        assertTrue(pids.contains(0x2E)) // Commanded evaporative purge
        assertFalse(pids.contains(0x2F)) // Fuel tank level input (UNSUPPORTED on vehicle)
        assertTrue(pids.contains(0x33)) // Absolute Barometric Pressure
        assertTrue(pids.contains(0x40)) // PIDs supported [41 - 60]
    }

    @Test
    fun parsesThirdBitmaskAndIdentifiesRelativeThrottleAndUnsupportedAmbientTemp() {
        val pids = ObdCapabilities.parseMask("41 40 4A DD 00 00")
        assertTrue(pids.contains(0x42)) // Control module voltage
        assertTrue(pids.contains(0x45)) // Relative throttle position (SUPPORTED)
        assertFalse(pids.contains(0x46)) // Ambient air temperature (UNSUPPORTED on vehicle)
        assertTrue(pids.contains(0x47)) // Absolute throttle position B
        assertFalse(pids.contains(0x60)) // PIDs supported [61 - 80]
    }

    @Test
    fun combinedVehicleCapabilitiesVerifyAllTargets() {
        val all = mutableSetOf<Int>()
        all.addAll(ObdCapabilities.parseMask("41 00 BE 3F B8 13"))
        all.addAll(ObdCapabilities.parseMask("41 20 80 04 20 01"))
        all.addAll(ObdCapabilities.parseMask("41 40 4A DD 00 00"))
        val caps = ObdCapabilities(all)

        assertTrue(caps.hasCapabilities())
        assertTrue(caps.isSupported(0x0C)) // RPM
        assertTrue(caps.isSupported(0x0D)) // Speed
        assertTrue(caps.isSupported(0x05)) // Coolant Temp
        assertTrue(caps.isSupported(0x0F)) // Intake Air Temp (Added)
        assertTrue(caps.isSupported(0x0B)) // MAP (Added)
        assertTrue(caps.isSupported(0x45)) // Relative Throttle (Added)
        assertTrue(caps.isSupported(0x42)) // Module Voltage
        assertFalse(caps.isSupported(0x2F)) // Fuel Level (Unsupported)
        assertFalse(caps.isSupported(0x46)) // Ambient Temp (Unsupported)
    }

    @Test
    fun handlesInvalidAndEmptyFramesGracefully() {
        assertTrue(ObdCapabilities.parseMask("NO DATA").isEmpty())
        assertTrue(ObdCapabilities.parseMask("SEARCHING...").isEmpty())
        assertFalse(ObdCapabilities.EMPTY.hasCapabilities())
        assertFalse(ObdCapabilities.EMPTY.isSupported(0x0C))
    }
}
