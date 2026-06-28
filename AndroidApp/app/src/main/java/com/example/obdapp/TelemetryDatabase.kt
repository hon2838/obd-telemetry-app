package com.example.obdapp

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update

@Entity(tableName = "telemetry_data")
data class TelemetryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
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
    var synced: Boolean = false
)

@Dao
interface TelemetryDao {
    @Insert
    suspend fun insert(telemetry: TelemetryEntity)

    @Query("SELECT * FROM telemetry_data WHERE synced = 0 ORDER BY timestamp ASC LIMIT 500")
    suspend fun getUnsyncedRecords(): List<TelemetryEntity>

    @Update
    suspend fun updateRecords(records: List<TelemetryEntity>)
    
    @Query("DELETE FROM telemetry_data WHERE synced = 1")
    suspend fun deleteSyncedRecords()
}
