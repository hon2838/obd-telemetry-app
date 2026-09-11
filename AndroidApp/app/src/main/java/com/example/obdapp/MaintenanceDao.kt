package com.example.obdapp

import androidx.room.*

@Dao
interface MaintenanceDao {
    @Insert
    suspend fun insert(item: MaintenanceEntity): Long

    @Query("SELECT * FROM maintenance_items WHERE synced = 0 ORDER BY id ASC LIMIT :limit")
    suspend fun getUnsyncedItems(limit: Int = 50): List<MaintenanceEntity>

    @Query("SELECT * FROM maintenance_items WHERE vehicleId = :vehicleId AND synced = 0 ORDER BY id ASC LIMIT :limit")
    suspend fun getUnsyncedItemsForVehicle(vehicleId: String, limit: Int = 50): List<MaintenanceEntity>

    @Query("SELECT DISTINCT vehicleId FROM maintenance_items WHERE synced = 0")
    suspend fun getUnsyncedVehicles(): List<String>

    @Query("SELECT COUNT(*) FROM maintenance_items WHERE vehicleId = :vehicleId AND synced = 0")
    suspend fun countUnsyncedForVehicle(vehicleId: String): Int

    @Update
    suspend fun updateItems(items: List<MaintenanceEntity>)

    @Query("DELETE FROM maintenance_items WHERE synced = 1")
    suspend fun deleteSyncedItems()

    @Query("DELETE FROM maintenance_items WHERE eventId IN (:eventIds)")
    suspend fun deleteByEventIds(eventIds: List<String>)

    @Query("SELECT * FROM maintenance_items ORDER BY id DESC")
    suspend fun getAll(): List<MaintenanceEntity>
}
