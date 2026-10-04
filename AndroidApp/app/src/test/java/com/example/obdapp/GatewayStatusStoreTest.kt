package com.example.obdapp

import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class GatewayStatusStoreTest {
    @After fun clear() { GatewayStatusStore.setRunning(false) }

    @Test fun newlyRecordedDataIsQueuedAfterSuccessfulUpload() {
        GatewayStatusStore.recordSync("a", GatewaySyncState.SYNCED, 100L)
        GatewayStatusStore.recordSample("a", true, 100L, 101L)
        assertEquals(GatewaySyncState.QUEUED, GatewayStatusStore.status.value.syncState)
    }

    @Test fun stopClearsPreviousConnectionsAndFixes() {
        GatewayStatusStore.recordSample("a", true, 100L, 101L)
        GatewayStatusStore.setRunning(false)
        assertEquals(GatewayStatus(), GatewayStatusStore.status.value)
    }

    @Test fun recordingDuringUploadDoesNotOverrideItsState() {
        GatewayStatusStore.recordSync("a", GatewaySyncState.UPLOADING, 100L)
        GatewayStatusStore.recordSample("a", false, null, 101L)
        assertEquals(GatewaySyncState.UPLOADING, GatewayStatusStore.status.value.syncState)
        assertFalse(GatewayStatusStore.status.value.gpsFix)
    }
}
