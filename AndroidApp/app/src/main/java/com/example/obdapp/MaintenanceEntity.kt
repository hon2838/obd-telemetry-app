package com.example.obdapp

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "maintenance_items")
data class MaintenanceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val serverId: String,
    val name: String,
    val intervalKm: Double?,
    val intervalDays: Int?,
    val lastServiceOdo: Double?,
    val lastServiceDate: Long?,
    val notes: String = "",
    var synced: Boolean = false
)
