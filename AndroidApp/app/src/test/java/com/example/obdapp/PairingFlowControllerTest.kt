package com.example.obdapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class PairingFlowControllerTest {
    @Test fun expiryUsesBoundedMonotonicDeadlineAndLegacyDefault() {
        val bounded = PairingFlowController(1_000, 2)
        assertTrue(bounded.canContinue(2_999))
        assertFalse(bounded.canContinue(3_000))
        assertFalse(bounded.isCancelled()) // Expiry still permits the terminal UI message.
        assertTrue(bounded.timeoutMillis(1_000, 15_000) in 1..2_000)

        val legacy = PairingFlowController(1_000, null)
        assertTrue(legacy.canContinue(600_999))
        assertFalse(legacy.canContinue(601_000))
    }

    @Test fun expiredPollResponseIsTerminalAndDismissalBlocksCredentialCommit() {
        val flow = PairingFlowController(10, 60)
        assertTrue(flow.isTerminalPollResponse(404, null))
        assertTrue(flow.isTerminalPollResponse(410, null))
        assertTrue(flow.isTerminalPollResponse(200, "expired"))
        assertFalse(flow.isTerminalPollResponse(503, "pending"))
        assertTrue(flow.canSaveApproval(11))
        flow.cancel()
        assertTrue(flow.isCancelled())
        assertFalse(flow.canContinue(11))
        assertFalse(flow.canSaveApproval(11))
        var saved = false
        assertFalse(flow.commitApproval(11) { saved = true })
        assertFalse(saved)
    }

    @Test fun dismissalDisconnectsActiveRequestAndRejectsTheNextRequest() {
        val flow = PairingFlowController(0, 60)
        val active = FakeConnection()
        flow.track(active)
        flow.cancel()
        assertTrue(active.disconnected)
        val late = FakeConnection()
        try {
            flow.track(late)
            throw AssertionError("A cancelled flow must reject requests")
        } catch (_: kotlinx.coroutines.CancellationException) {
            assertTrue(late.disconnected)
        }
    }

    @Test fun approvalThatCommitsBeforeDismissalFinishesAsOneOperation() {
        val flow = PairingFlowController(0, 60)
        val saving = CountDownLatch(1)
        val releaseSave = CountDownLatch(1)
        var saved = false
        val worker = thread {
            flow.commitApproval(1) {
                saving.countDown()
                check(releaseSave.await(5, TimeUnit.SECONDS))
                saved = true
            }
        }
        try {
            assertTrue(saving.await(5, TimeUnit.SECONDS))
            val cancelling = thread { flow.cancel() }
            releaseSave.countDown()
            worker.join(5000)
            cancelling.join(5000)
            assertFalse(worker.isAlive)
            assertFalse(cancelling.isAlive)
            assertTrue(saved)
            assertFalse(flow.canContinue(2))
        } finally {
            releaseSave.countDown()
        }
    }

    private class FakeConnection : HttpURLConnection(URL("http://127.0.0.1")) {
        var disconnected = false
        override fun disconnect() { disconnected = true }
        override fun usingProxy() = false
        override fun connect() = Unit
    }
}
