package com.example.obdapp

import androidx.room.*

@Dao
interface FuelLogDao {
    @Insert
    suspend fun insert(fuelLog: FuelLogEntity)

    @Query("SELECT * FROM fuel_logs WHERE synced = 0 ORDER BY timestamp ASC")
    suspend fun getUnsyncedLogs(): List<FuelLogEntity>

    @Update
    suspend fun updateLogs(records: List<FuelLogEntity>)

    @Query("DELETE FROM fuel_logs WHERE synced = 1")
    suspend fun deleteSyncedLogs()

    @Query("SELECT * FROM fuel_logs ORDER BY odometer DESC")
    suspend fun getAll(): List<FuelLogEntity>
}
