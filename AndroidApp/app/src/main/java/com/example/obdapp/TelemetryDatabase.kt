package com.example.obdapp

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import java.util.UUID

@Entity(
    tableName = "telemetry_data",
    indices = [
        Index(value = ["synced", "id"]),
        Index(value = ["vehicleId", "synced"]),
        Index(value = ["eventId"], unique = true)
    ]
)
data class TelemetryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(defaultValue = "") val eventId: String = UUID.randomUUID().toString(),
    val timestamp: Long,
    val rpm: Int?,
    val speed: Int?,
    val coolantTemp: Int?,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double,
    val gpsSpeed: Float,
    val engineLoad: Int?,
    val throttlePos: Int?,
    val fuelLevel: Int?,
    val ambientTemp: Int?,
    val voltage: Float?,
    val accelTime: Double? = null,
    val alertCoolant: Boolean? = null,
    val alertVoltage: Boolean? = null,
    val accOn: Boolean? = null,
    val headlightOn: Boolean? = null,
    val volume: Int? = null,
    val wifiSsid: String? = null,
    val btConnected: Boolean? = null,
    val mafGps: Double? = null,
    val fuelSystemStatus: Int? = null,
    val estimatedFuelRateLph: Double? = null,
    val estimatedFuelEconomyKmL: Double? = null,
    val iat: Int? = null,
    val map: Int? = null,
    @ColumnInfo(defaultValue = "default") val vehicleId: String = "default",
    var synced: Boolean = false
)

@Dao
interface TelemetryDao {
    @Insert
    suspend fun insert(telemetry: TelemetryEntity)

    @Query("SELECT * FROM telemetry_data WHERE synced = 0 ORDER BY timestamp ASC LIMIT :limit")
    suspend fun getUnsyncedRecords(limit: Int = 100): List<TelemetryEntity>

    @Query("SELECT * FROM telemetry_data WHERE vehicleId = :vehicleId AND synced = 0 ORDER BY timestamp ASC LIMIT :limit")
    suspend fun getUnsyncedRecordsForVehicle(vehicleId: String, limit: Int = 100): List<TelemetryEntity>

    @Query("SELECT DISTINCT vehicleId FROM telemetry_data WHERE synced = 0")
    suspend fun getUnsyncedVehicles(): List<String>

    @Query("SELECT COUNT(*) FROM telemetry_data WHERE vehicleId = :vehicleId AND synced = 0")
    suspend fun countUnsyncedForVehicle(vehicleId: String): Int

    @Update
    suspend fun updateRecords(records: List<TelemetryEntity>)

    @Query("DELETE FROM telemetry_data WHERE synced = 1")
    suspend fun deleteSyncedRecords()

    @Query("DELETE FROM telemetry_data WHERE eventId IN (:eventIds)")
    suspend fun deleteByEventIds(eventIds: List<String>)
}
