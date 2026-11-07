package com.example.obdapp

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class CommandAckPolicyTest {
    @Test fun onlyRecognizedPermanentResponsesStopRetriesImmediately() {
        for ((status, code) in listOf(404 to "COMMAND_NOT_FOUND", 410 to "COMMAND_RETIRED", 409 to "COMMAND_ACK_CONFLICT")) {
            assertTrue(CommandAckPolicy.isUnreconcilable(HttpResponse(status, """{"code":"$code","retryable":false}""", false)))
            assertFalse(CommandAckPolicy.isUnreconcilable(HttpResponse(status, """{"code":"$code","retryable":true}""", false)))
            assertFalse(CommandAckPolicy.isUnreconcilable(HttpResponse(status, """{"code":"$code","retryable":"false"}""", false)))
        }
        for (response in listOf(HttpResponse(404, "Not Found", false), HttpResponse(404, "{}", false),
            HttpResponse(503, """{"code":"COMMAND_NOT_FOUND","retryable":false}""", false))) {
            assertFalse(CommandAckPolicy.isUnreconcilable(response))
        }
    }

    @Test fun retryHorizonIsAbsoluteAndDoesNotTreatClockRollbackAsExpiry() {
        val created = 1000L
        assertFalse(CommandAckPolicy.retryWindowExpired(created, created + CommandAckPolicy.MAX_RETRY_AGE_MS))
        assertTrue(CommandAckPolicy.retryWindowExpired(created, created + CommandAckPolicy.MAX_RETRY_AGE_MS + 1))
        assertFalse(CommandAckPolicy.retryWindowExpired(created, created - 1))
    }
}
