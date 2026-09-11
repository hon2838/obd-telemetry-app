package com.example.obdapp

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "maintenance_items",
    indices = [
        Index(value = ["synced", "id"]),
        Index(value = ["vehicleId", "synced"]),
        Index(value = ["eventId"], unique = true)
    ]
)
data class MaintenanceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(defaultValue = "") val eventId: String = UUID.randomUUID().toString(),
    val serverId: String,
    val name: String,
    val intervalKm: Double?,
    val intervalDays: Int?,
    val lastServiceOdo: Double?,
    val lastServiceDate: Long?,
    val notes: String = "",
    @ColumnInfo(defaultValue = "default") val vehicleId: String = "default",
    var synced: Boolean = false
)
