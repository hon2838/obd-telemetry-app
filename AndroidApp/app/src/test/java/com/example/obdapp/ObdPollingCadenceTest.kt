package com.example.obdapp

import org.junit.Assert.assertEquals
import org.junit.Test

class ObdPollingCadenceTest {
    @Test
    fun subtractsAdapterAndPersistenceWorkFromTargetInterval() {
        assertEquals(100L, ObdPollingCadence.pauseAfterCycle(400L, true))
    }

    @Test
    fun slowAdapterDoesNotTriggerCatchUpLoop() {
        assertEquals(50L, ObdPollingCadence.pauseAfterCycle(1_800L, true))
    }

    @Test
    fun gpsOnlyCollectionAlsoTargetsHalfASecond() {
        assertEquals(300L, ObdPollingCadence.pauseAfterCycle(200L, false))
    }
}
