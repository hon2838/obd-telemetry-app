package com.example.obdapp

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "fuel_logs",
    indices = [
        Index(value = ["synced", "id"]),
        Index(value = ["vehicleId", "synced"]),
        Index(value = ["eventId"], unique = true)
    ]
)
data class FuelLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(defaultValue = "") val eventId: String = UUID.randomUUID().toString(),
    val timestamp: Long,
    val litres: Double,
    val odometer: Double,
    @ColumnInfo(defaultValue = "default") val vehicleId: String = "default",
    var synced: Boolean = false
)
