package com.example.obdapp

import org.json.JSONObject

internal object CommandAckPolicy {
    const val MAX_RETRY_AGE_MS = 7L * 24 * 60 * 60 * 1000

    // Based on immutable receipt time, not updatedAt (which advances on every retry).
    fun retryWindowExpired(createdAt: Long, now: Long): Boolean =
        createdAt >= 0 && now >= createdAt && now - createdAt > MAX_RETRY_AGE_MS

    fun isUnreconcilable(response: HttpResponse): Boolean {
        val expected = when (response.statusCode) {
            404 -> "COMMAND_NOT_FOUND"
            410 -> "COMMAND_RETIRED"
            409 -> "COMMAND_ACK_CONFLICT"
            else -> return false
        }
        return try {
            val body = JSONObject(response.body)
            body.optString("code") == expected && body.opt("retryable") == false
        } catch (_: Exception) { false }
    }
}
