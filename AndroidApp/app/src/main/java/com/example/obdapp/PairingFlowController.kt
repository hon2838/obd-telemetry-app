package com.example.obdapp

import kotlinx.coroutines.CancellationException
import java.net.HttpURLConnection

/** Owns the UI pairing deadline and the currently blocking HTTP request. */
internal class PairingFlowController(
    private val startedAtElapsedMs: Long,
    expiresInSeconds: Long?,
    private val legacyDefaultSeconds: Long = 600L
) {
    @Volatile private var deadlineElapsedMs = deadline(startedAtElapsedMs, expiresInSeconds ?: legacyDefaultSeconds)
    @Volatile private var cancelled = false
    @Volatile private var connection: HttpURLConnection? = null

    fun isExpired(nowElapsedMs: Long): Boolean = nowElapsedMs >= deadlineElapsedMs

    fun isCancelled(): Boolean = cancelled

    fun canContinue(nowElapsedMs: Long): Boolean = !cancelled && !isExpired(nowElapsedMs)

    fun canSaveApproval(nowElapsedMs: Long): Boolean = canContinue(nowElapsedMs)

    fun timeoutMillis(nowElapsedMs: Long, maximumMillis: Int): Int =
        (deadlineElapsedMs - nowElapsedMs).coerceIn(1L, maximumMillis.toLong()).toInt()

    @Synchronized
    fun setDeadline(startedAtElapsedMs: Long, expiresInSeconds: Long?) {
        deadlineElapsedMs = deadline(startedAtElapsedMs, expiresInSeconds?.takeIf { it > 0 } ?: legacyDefaultSeconds)
    }

    /** Serializes the final credential write against dialog dismissal. */
    @Synchronized
    fun commitApproval(nowElapsedMs: Long, save: () -> Unit): Boolean {
        if (!canSaveApproval(nowElapsedMs)) return false
        save()
        return true
    }

    fun isTerminalPollResponse(statusCode: Int, bodyStatus: String?): Boolean =
        statusCode == 404 || statusCode == 410 || bodyStatus.equals("expired", ignoreCase = true)

    @Synchronized
    fun track(request: HttpURLConnection) {
        if (cancelled) {
            request.disconnect()
            throw CancellationException("Pairing dialog was dismissed")
        }
        connection = request
    }

    @Synchronized
    fun release(request: HttpURLConnection) {
        if (connection === request) connection = null
        request.disconnect()
    }

    @Synchronized
    fun cancel() {
        cancelled = true
        connection?.disconnect()
        connection = null
    }

    private fun deadline(start: Long, seconds: Long): Long {
        val duration = seconds.coerceAtMost(Long.MAX_VALUE / 1000) * 1000
        return if (start > Long.MAX_VALUE - duration) Long.MAX_VALUE else start + duration
    }
}
