package com.example.obdapp

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class AccelerationTrackerTest {

    private lateinit var tracker: AccelerationTracker
    private var completedCallbackTime: Double? = null

    @Before
    fun setUp() {
        completedCallbackTime = null
        tracker = AccelerationTracker { time ->
            completedCallbackTime = time
        }
    }

    @Test
    fun testInitialStateIsIdle() {
        assertEquals(AccelerationTracker.State.IDLE, tracker.state)
        assertNull(tracker.latestCompletedTime)
    }

    @Test
    fun testArmingAtStandstill() {
        // Vehicle moving slowly (e.g. 50 km/h), should stay IDLE
        tracker.processSpeed(50.0f, 1000L)
        assertEquals(AccelerationTracker.State.IDLE, tracker.state)

        // Vehicle stops (speed <= 2.0 km/h)
        tracker.processSpeed(0.8f, 2000L)
        assertEquals(AccelerationTracker.State.ARMED, tracker.state)
    }

    @Test
    fun testJitterInArmedStateDoesNotLaunch() {
        // Arm
        tracker.processSpeed(0.0f, 1000L)
        assertEquals(AccelerationTracker.State.ARMED, tracker.state)

        // Small GPS jitter (e.g. 2.4 km/h)
        tracker.processSpeed(2.4f, 2000L)
        assertEquals(AccelerationTracker.State.ARMED, tracker.state)
    }

    @Test
    fun testSuccessfulSprintWithSubSecondLinearInterpolation() {
        // 1. Vehicle stopped and armed at t = 1000ms, speed = 0.5 km/h
        tracker.processSpeed(0.5f, 1000L)
        assertEquals(AccelerationTracker.State.ARMED, tracker.state)

        // 2. Launch at t = 2000ms, speed = 10.5 km/h
        // Linear interpolation for crossing 0 km/h:
        // ratio = (0.0 - 0.5) / (10.5 - 0.5) = -0.05
        // t0 = 1000 + (-0.05 * 1000) = 950ms
        tracker.processSpeed(10.5f, 2000L)
        assertEquals(AccelerationTracker.State.ACCELERATING, tracker.state)

        // 3. Acceleration progress
        tracker.processSpeed(35.0f, 3000L)
        assertEquals(AccelerationTracker.State.ACCELERATING, tracker.state)

        tracker.processSpeed(60.0f, 4000L)
        assertEquals(AccelerationTracker.State.ACCELERATING, tracker.state)

        tracker.processSpeed(80.0f, 5000L)
        assertEquals(AccelerationTracker.State.ACCELERATING, tracker.state)

        // 4. Crossing 100 km/h at t = 6000ms with speed = 105.0 km/h
        // Linear interpolation for crossing 100 km/h:
        // ratio = (100.0 - 80.0) / (105.0 - 80.0) = 20.0 / 25.0 = 0.8
        // t100 = 5000 + (0.8 * 1000) = 5800ms
        // Sprint duration = (5800 - 950) / 1000 = 4.85 seconds
        val completed = tracker.processSpeed(105.0f, 6000L)

        assertNotNull(completed)
        assertEquals(4.85, completed!!, 0.01)
        assertEquals(4.85, completedCallbackTime!!, 0.01)
        assertEquals(AccelerationTracker.State.IDLE, tracker.state)

        // Verify harvestCompletedTime returns the value and clears it
        val harvested = tracker.harvestCompletedTime()
        assertEquals(4.85, harvested!!, 0.01)
        assertNull(tracker.harvestCompletedTime())
    }

    @Test
    fun testAbortOnDrasticDeceleration() {
        // Arm and launch
        tracker.processSpeed(0.0f, 1000L)
        tracker.processSpeed(15.0f, 2000L)
        assertEquals(AccelerationTracker.State.ACCELERATING, tracker.state)

        tracker.processSpeed(50.0f, 3000L)
        assertEquals(AccelerationTracker.State.ACCELERATING, tracker.state)

        // Sudden brake: speed drops from 50 to 30 (> 15 km/h drop)
        tracker.processSpeed(30.0f, 4000L)
        // Should abort
        assertNotEquals(AccelerationTracker.State.ACCELERATING, tracker.state)
        assertNull(tracker.latestCompletedTime)
    }

    @Test
    fun testAbortOnDropBelowFiveKmh() {
        // Arm and launch
        tracker.processSpeed(0.0f, 1000L)
        tracker.processSpeed(8.0f, 2000L)
        assertEquals(AccelerationTracker.State.ACCELERATING, tracker.state)

        // Driver gives up and comes back to stop
        tracker.processSpeed(3.0f, 3000L)
        assertNotEquals(AccelerationTracker.State.ACCELERATING, tracker.state)
        assertNull(tracker.latestCompletedTime)
    }

    @Test
    fun testAbortOnTimeout() {
        // Arm and launch
        tracker.processSpeed(0.0f, 1000L)
        tracker.processSpeed(10.0f, 2000L)
        assertEquals(AccelerationTracker.State.ACCELERATING, tracker.state)

        // Slow crawl reaching 90 km/h after 35 seconds
        tracker.processSpeed(90.0f, 37000L)
        // Elapsed = 37000 - 1000 > 30000ms -> should timeout
        assertNotEquals(AccelerationTracker.State.ACCELERATING, tracker.state)
        assertNull(tracker.latestCompletedTime)
    }
}
