package com.example.obdapp

import android.util.Log
import java.util.Locale

/**
 * Tracks 0-100 km/h sprint acceleration using GPS ground speed or OBD vehicle speed.
 * Uses sub-second linear interpolation to accurately calculate the launch instant (0 km/h)
 * and finish crossing instant (100 km/h) even with 1 Hz GPS update rates.
 */
class AccelerationTracker(
    private val onRunCompleted: ((Double) -> Unit)? = null
) {
    companion object {
        private const val TAG = "AccelerationTracker"
        const val ARM_SPEED_THRESHOLD = 2.0f
        const val LAUNCH_SPEED_THRESHOLD = 3.0f
        const val FINISH_SPEED_THRESHOLD = 100.0f
        const val MIN_VALID_DURATION_SEC = 1.5
        const val MAX_VALID_DURATION_SEC = 30.0
    }

    enum class State {
        IDLE,
        ARMED,
        ACCELERATING
    }

    private val lock = Any()
    var state: State = State.IDLE
        private set

    private var launchTimeMs: Double = 0.0
    private var lastSpeedKmh: Float = 0.0f
    private var lastSpeedTimestampMs: Long = 0L

    @Volatile
    var latestCompletedTime: Double? = null
        private set

    fun processSpeed(speedKmh: Float, timestampMs: Long): Double? {
        synchronized(lock) {
            val now = if (timestampMs > 0) timestampMs else System.currentTimeMillis()
            val prevSpeed = lastSpeedKmh
            val prevTime = if (lastSpeedTimestampMs > 0) lastSpeedTimestampMs else now

            lastSpeedKmh = speedKmh
            lastSpeedTimestampMs = now

            when (state) {
                State.IDLE -> {
                    if (speedKmh <= ARM_SPEED_THRESHOLD) {
                        state = State.ARMED
                        Log.d(TAG, "0-100 tracker ARMED (speed: ${String.format(Locale.US, "%.1f", speedKmh)} km/h)")
                    }
                }
                State.ARMED -> {
                    if (speedKmh <= ARM_SPEED_THRESHOLD) {
                        // Stationary / GPS noise
                    } else if (speedKmh <= LAUNCH_SPEED_THRESHOLD) {
                        // Creep / jitter
                    } else {
                        // Launch detected!
                        val dt = (now - prevTime).coerceAtLeast(1L)
                        val t0 = if (prevSpeed < speedKmh && prevSpeed <= ARM_SPEED_THRESHOLD) {
                            // Linearly estimate the instant speed crossed 0 km/h
                            val ratio = ((0.0f - prevSpeed) / (speedKmh - prevSpeed)).toDouble()
                            val estimatedT0 = prevTime + (ratio * dt)
                            estimatedT0.coerceIn((prevTime - dt).toDouble(), now.toDouble())
                        } else {
                            prevTime.toDouble()
                        }
                        launchTimeMs = t0
                        state = State.ACCELERATING
                        Log.i(TAG, "0-100 tracker LAUNCH detected at ${String.format(Locale.US, "%.1f", speedKmh)} km/h (dt=${dt}ms, t0=${String.format(Locale.US, "%.0f", t0)})")
                    }
                }
                State.ACCELERATING -> {
                    val elapsedMs = now - launchTimeMs.toLong()

                    // Abort if timed out (> 30s)
                    if (elapsedMs > (MAX_VALID_DURATION_SEC * 1000).toLong()) {
                        Log.i(TAG, "0-100 run timed out (> 30s)")
                        state = if (speedKmh <= ARM_SPEED_THRESHOLD) State.ARMED else State.IDLE
                        return null
                    }

                    // Abort if vehicle slowed down drastically
                    if (speedKmh < 5.0f || (prevSpeed - speedKmh) > 15.0f) {
                        Log.i(TAG, "0-100 run aborted: speed dropped to ${String.format(Locale.US, "%.1f", speedKmh)} km/h")
                        state = if (speedKmh <= ARM_SPEED_THRESHOLD) State.ARMED else State.IDLE
                        return null
                    }

                    // Finish condition: reached or crossed 100 km/h
                    if (speedKmh >= FINISH_SPEED_THRESHOLD) {
                        val dt = (now - prevTime).coerceAtLeast(1L)
                        val t100 = if (speedKmh > prevSpeed && prevSpeed < FINISH_SPEED_THRESHOLD) {
                            val ratio = ((FINISH_SPEED_THRESHOLD - prevSpeed) / (speedKmh - prevSpeed)).toDouble().coerceIn(0.0, 1.0)
                            prevTime + (ratio * dt)
                        } else {
                            now.toDouble()
                        }

                        val durationSec = (t100 - launchTimeMs) / 1000.0
                        if (durationSec in MIN_VALID_DURATION_SEC..MAX_VALID_DURATION_SEC) {
                            val finalTime = Math.round(durationSec * 100.0) / 100.0
                            latestCompletedTime = finalTime
                            Log.i(TAG, "0-100 SPRINT COMPLETED: ${finalTime}s")
                            onRunCompleted?.invoke(finalTime)
                            state = State.IDLE
                            return finalTime
                        } else {
                            Log.w(TAG, "0-100 run duration out of bounds: ${durationSec}s")
                        }
                        state = State.IDLE
                    }
                }
            }
            return null
        }
    }

    fun harvestCompletedTime(): Double? {
        synchronized(lock) {
            val res = latestCompletedTime
            latestCompletedTime = null
            return res
        }
    }

    fun reset() {
        synchronized(lock) {
            state = State.IDLE
            launchTimeMs = 0.0
            lastSpeedKmh = 0.0f
            lastSpeedTimestampMs = 0L
            latestCompletedTime = null
        }
    }
}
