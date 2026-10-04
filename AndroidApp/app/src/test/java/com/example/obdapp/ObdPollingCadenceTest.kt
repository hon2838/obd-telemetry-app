package com.example.obdapp

import org.junit.Assert.assertEquals
import org.junit.Test

class ObdPollingCadenceTest {
    @Test
    fun subtractsAdapterAndPersistenceWorkFromTargetInterval() {
        assertEquals(600L, ObdPollingCadence.pauseAfterCycle(400L, true))
    }

    @Test
    fun slowAdapterDoesNotTriggerCatchUpLoop() {
        assertEquals(50L, ObdPollingCadence.pauseAfterCycle(1_800L, true))
    }

    @Test
    fun preservesGpsOnlyCollectionInterval() {
        assertEquals(2_800L, ObdPollingCadence.pauseAfterCycle(200L, false))
    }
}
