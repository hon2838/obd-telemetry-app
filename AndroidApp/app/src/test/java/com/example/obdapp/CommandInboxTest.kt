package com.example.obdapp

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class CommandInboxTest {
    private lateinit var db: AppDatabase
    private lateinit var dao: CommandInboxDao

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            AppDatabase::class.java
        ).allowMainThreadQueries().build()
        dao = db.commandInboxDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun duplicateDeliveryKeepsOneInboxRowAndOnlyOneClaimSucceeds() = runBlocking {
        val now = 1_000L
        val command = CommandEnvelopeParser.parse(
            JSONObject("""{"id":"cmd-1","command":"clear_dtc","vehicleId":"car-a","expiresAt":5000}"""),
            now
        )!!
        dao.insertIfAbsent(command)
        dao.insertIfAbsent(command.copy(state = CommandState.ACK_PENDING, ackStatus = "completed"))

        assertEquals(1, dao.getReady("car-a").size)
        assertEquals(1, dao.claim("cmd-1", 2_000L))
        assertEquals(0, dao.claim("cmd-1", 2_001L))
    }

    @Test
    fun v2CommandWithoutExpiryIsRejected() {
        assertNull(CommandEnvelopeParser.parse(JSONObject("""{"id":"cmd-1","command":"clear_dtc","vehicleId":"car-a"}"""), 1L))
    }

    @Test
    fun interruptedClearBecomesUnknownAndIsNeverReadyForReplay() = runBlocking {
        dao.insertIfAbsent(
            CommandInboxEntity("cmd-clear", "clear_dtc", "car-a", createdAt = 1L, updatedAt = 1L)
        )
        assertEquals(1, dao.claim("cmd-clear", 2L))

        assertEquals(1, dao.markInterruptedClearsUnknown(3L))
        assertTrue(dao.getReady("car-a").isEmpty())
        val ack = dao.getPendingAcks("car-a").single()
        assertEquals("unknown", ack.ackStatus)
        assertEquals("{\"reason\":\"App stopped during clear_dtc; the vehicle may or may not have cleared its codes. User review is required.\"}", ack.result)
    }

    @Test
    fun staleCommandCannotBeClaimedAndBecomesFailedAck() = runBlocking {
        dao.insertIfAbsent(
            CommandInboxEntity("cmd-old", "read_dtc", "car-a", expiresAt = 10L, createdAt = 1L, updatedAt = 1L)
        )
        assertEquals(0, dao.claim("cmd-old", 10L))
        assertEquals(1, dao.markExpired("cmd-old", 10L))
        val ack = dao.getPendingAcks("car-a").single()
        assertEquals("failed", ack.ackStatus)
        assertEquals("{\"reason\":\"expired\"}", ack.result)
    }

    @Test
    fun acknowledgmentsArePagedWithinVehicleSoOtherVehiclesCannotStarveThem() = runBlocking {
        repeat(60) { index ->
            dao.insertIfAbsent(
                CommandInboxEntity(
                    id = "old-$index",
                    command = "read_dtc",
                    vehicleId = "old-car",
                    state = CommandState.ACK_PENDING,
                    result = "{}",
                    ackStatus = "completed",
                    createdAt = index.toLong(),
                    updatedAt = index.toLong()
                )
            )
        }
        dao.insertIfAbsent(
            CommandInboxEntity(
                id = "active-command",
                command = "read_dtc",
                vehicleId = "active-car",
                state = CommandState.ACK_PENDING,
                result = "{}",
                ackStatus = "completed",
                createdAt = 100L,
                updatedAt = 100L
            )
        )

        assertEquals(listOf("active-command"), dao.getPendingAcks("active-car").map { it.id })
    }

    @Test
    fun failedAckIsDeferredWithoutDroppingLocalResultOrBlockingTheNextPage() = runBlocking {
        repeat(51) { index ->
            dao.insertIfAbsent(
                CommandInboxEntity(
                    id = "ack-$index",
                    command = "read_dtc",
                    vehicleId = "car-a",
                    state = CommandState.ACK_PENDING,
                    result = "{}",
                    ackStatus = "completed",
                    createdAt = index.toLong(),
                    updatedAt = index.toLong()
                )
            )
        }

        val firstPage = dao.getPendingAcks("car-a")
        assertEquals(50, firstPage.size)
        firstPage.forEach { dao.deferAckRetry(it.id, 10_000L) }

        val nextPage = dao.getPendingAcks("car-a")
        assertEquals("ack-50", nextPage.first().id)
        assertEquals(CommandState.ACK_PENDING, dao.getPendingAcks("car-a", 100).first { it.id == "ack-0" }.state)
    }

    @Test
    fun legacyCommandsAreDurableButDoNotUseV2AckProtocol() {
        val legacy = CommandEnvelopeParser.parseLegacy("read_dtc", "car-a", 1L)!!
        assertFalse(legacy.requiresAck)
        assertEquals("car-a", legacy.vehicleId)
        assertNull(CommandEnvelopeParser.parseLegacy("delete_all", "car-a"))
    }
}
