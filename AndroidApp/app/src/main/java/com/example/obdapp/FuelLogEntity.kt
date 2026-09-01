package com.example.obdapp

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "fuel_logs")
data class FuelLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long,
    val litres: Double,
    val odometer: Double,
    @ColumnInfo(defaultValue = "default") val vehicleId: String = "default",
    var synced: Boolean = false
)
