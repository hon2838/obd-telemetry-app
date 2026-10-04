package com.example.obdapp

internal object ObdPollingCadence {
    // RPM, speed, throttle and available fuel-estimate inputs share one cycle.
    const val FAST_INTERVAL_MS = 1_000L
    const val SECONDARY_INTERVAL_MS = 5_000L
    const val GPS_ONLY_INTERVAL_MS = 3_000L
    const val COMMAND_GAP_MS = 50L
    private const val MIN_PAUSE_MS = 50L

    fun pauseAfterCycle(elapsedMs: Long, connected: Boolean): Long {
        val interval = if (connected) FAST_INTERVAL_MS else GPS_ONLY_INTERVAL_MS
        // Long adapter replies slow the cycle naturally; never queue catch-up
        // work or spin without a pause when the target interval is exceeded.
        return (interval - elapsedMs.coerceAtLeast(0L)).coerceAtLeast(MIN_PAUSE_MS)
    }
}
