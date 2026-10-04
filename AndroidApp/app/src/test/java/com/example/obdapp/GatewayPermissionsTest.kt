package com.example.obdapp

import android.Manifest
import org.junit.Assert.*
import org.junit.Test

class GatewayPermissionsTest {
    @Test fun modernPhoneUsesNearbyDevicePermissionsWithoutBackgroundLocation() {
        val permissions = GatewayPermissions.required(36, 36)
        assertTrue(permissions.contains(Manifest.permission.BLUETOOTH_CONNECT))
        assertTrue(permissions.contains(Manifest.permission.BLUETOOTH_SCAN))
        assertFalse(permissions.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
    }

    @Test fun oldHeadUnitRetainsItsExistingPermissionContract() {
        val permissions = GatewayPermissions.required(29, 29)
        assertTrue(permissions.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        assertFalse(permissions.contains(Manifest.permission.BLUETOOTH_CONNECT))
    }

    @Test fun olderPhoneDoesNotRequestUnavailableNearbyDevicePermissions() {
        val permissions = GatewayPermissions.required(30, 36)
        assertFalse(permissions.contains(Manifest.permission.BLUETOOTH_CONNECT))
        assertFalse(permissions.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
    }
}
