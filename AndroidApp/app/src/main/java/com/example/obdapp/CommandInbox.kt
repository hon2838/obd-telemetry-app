package com.example.obdapp

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/** A command is recorded before it can be sent to the physical adapter. */
@Entity(
    tableName = "command_inbox",
    indices = [Index(value = ["vehicleId", "state"])]
)
data class CommandInboxEntity(
    @PrimaryKey val id: String,
    val command: String,
    val vehicleId: String,
    val state: String = CommandState.RECEIVED,
    val result: String? = null,
    val ackStatus: String? = null,
    val expiresAt: Long? = null,
    val requiresAck: Boolean = true,
    val createdAt: Long,
    val updatedAt: Long
)

object CommandState {
    const val RECEIVED = "received"
    const val STARTED = "started"
    const val ACK_PENDING = "ack_pending"
    const val ACKED = "acked"
}

@Dao
interface CommandInboxDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfAbsent(command: CommandInboxEntity): Long

    @Query("SELECT * FROM command_inbox WHERE vehicleId = :vehicleId AND state = 'received' ORDER BY createdAt, id")
    suspend fun getReady(vehicleId: String): List<CommandInboxEntity>

    @Query("SELECT * FROM command_inbox WHERE vehicleId = :vehicleId AND state = 'ack_pending' ORDER BY updatedAt, createdAt, id LIMIT :limit")
    suspend fun getPendingAcks(vehicleId: String, limit: Int = 50): List<CommandInboxEntity>

    @Query("UPDATE command_inbox SET state = 'started', updatedAt = :now WHERE id = :id AND state = 'received' AND (expiresAt IS NULL OR expiresAt > :now)")
    suspend fun claim(id: String, now: Long): Int

    @Query("UPDATE command_inbox SET state = 'ack_pending', result = '{\"reason\":\"expired\"}', ackStatus = 'failed', updatedAt = :now WHERE id = :id AND state = 'received' AND expiresAt IS NOT NULL AND expiresAt <= :now")
    suspend fun markExpired(id: String, now: Long): Int

    @Query("UPDATE command_inbox SET state = 'ack_pending', result = :result, ackStatus = :ackStatus, updatedAt = :now WHERE id = :id AND state = 'started'")
    suspend fun saveResult(id: String, result: String?, ackStatus: String, now: Long): Int

    @Query("UPDATE command_inbox SET state = 'acked', updatedAt = :now WHERE id = :id AND state = 'ack_pending'")
    suspend fun markAcked(id: String, now: Long): Int

    @Query("UPDATE command_inbox SET updatedAt = :now WHERE id = :id AND state = 'ack_pending'")
    suspend fun deferAckRetry(id: String, now: Long): Int

    /** On process restart, reads may be repeated; a reset may have happened, so never repeat it automatically. */
    @Query("UPDATE command_inbox SET state = 'received', updatedAt = :now WHERE state = 'started' AND command = 'read_dtc'")
    suspend fun recoverInterruptedReads(now: Long): Int

    @Query("UPDATE command_inbox SET state = 'ack_pending', ackStatus = 'unknown', result = '{\"reason\":\"App stopped during clear_dtc; the vehicle may or may not have cleared its codes. User review is required.\"}', updatedAt = :now WHERE state = 'started' AND command = 'clear_dtc'")
    suspend fun markInterruptedClearsUnknown(now: Long): Int

    @Query("DELETE FROM command_inbox WHERE state = 'acked' AND updatedAt < :olderThan")
    suspend fun deleteOldAcked(olderThan: Long): Int
}

/** Validates and normalizes command envelopes. Legacy string responses remain supported. */
object CommandEnvelopeParser {
    private val allowed = setOf("read_dtc", "clear_dtc")

    fun parse(value: org.json.JSONObject, now: Long = System.currentTimeMillis()): CommandInboxEntity? {
        val id = value.optString("id").trim()
        val command = value.optString("command").trim()
        val vehicleId = value.optString("vehicleId").trim()
        if (id.isEmpty() || vehicleId.isEmpty() || command !in allowed) return null
        // A v2 command without a deadline could run long after it was issued.
        val expiresAt = value.optLong("expiresAt", 0L).takeIf { it > 0L } ?: return null
        return CommandInboxEntity(id, command, vehicleId, expiresAt = expiresAt, createdAt = now, updatedAt = now)
    }

    fun parseLegacy(command: String, vehicleId: String, now: Long = System.currentTimeMillis()): CommandInboxEntity? {
        val normalized = command.trim()
        if (normalized !in allowed || vehicleId.isBlank()) return null
        return CommandInboxEntity(
            id = "legacy:${java.util.UUID.randomUUID()}",
            command = normalized,
            vehicleId = vehicleId,
            requiresAck = false,
            createdAt = now,
            updatedAt = now
        )
    }
}
