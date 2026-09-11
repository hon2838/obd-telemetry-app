package com.example.obdapp

import androidx.room.*

@Dao
interface FuelLogDao {
    @Insert
    suspend fun insert(fuelLog: FuelLogEntity): Long

    @Query("SELECT * FROM fuel_logs WHERE synced = 0 ORDER BY timestamp ASC LIMIT :limit")
    suspend fun getUnsyncedLogs(limit: Int = 50): List<FuelLogEntity>

    @Query("SELECT * FROM fuel_logs WHERE vehicleId = :vehicleId AND synced = 0 ORDER BY timestamp ASC LIMIT :limit")
    suspend fun getUnsyncedLogsForVehicle(vehicleId: String, limit: Int = 50): List<FuelLogEntity>

    @Query("SELECT DISTINCT vehicleId FROM fuel_logs WHERE synced = 0")
    suspend fun getUnsyncedVehicles(): List<String>

    @Query("SELECT COUNT(*) FROM fuel_logs WHERE vehicleId = :vehicleId AND synced = 0")
    suspend fun countUnsyncedForVehicle(vehicleId: String): Int

    @Update
    suspend fun updateLogs(records: List<FuelLogEntity>)

    @Query("DELETE FROM fuel_logs WHERE synced = 1")
    suspend fun deleteSyncedLogs()

    @Query("DELETE FROM fuel_logs WHERE eventId IN (:eventIds)")
    suspend fun deleteByEventIds(eventIds: List<String>)

    @Query("SELECT * FROM fuel_logs ORDER BY odometer DESC")
    suspend fun getAll(): List<FuelLogEntity>
}
