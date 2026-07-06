package com.example.obdapp

import androidx.room.*

@Dao
interface MaintenanceDao {
    @Insert
    suspend fun insert(item: MaintenanceEntity)

    @Query("SELECT * FROM maintenance_items WHERE synced = 0 ORDER BY id ASC")
    suspend fun getUnsyncedItems(): List<MaintenanceEntity>

    @Update
    suspend fun updateItems(items: List<MaintenanceEntity>)

    @Query("DELETE FROM maintenance_items WHERE synced = 1")
    suspend fun deleteSyncedItems()

    @Query("SELECT * FROM maintenance_items ORDER BY id DESC")
    suspend fun getAll(): List<MaintenanceEntity>
}
