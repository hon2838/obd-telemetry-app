package com.example.obdapp

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Garage: the list of vehicles this app installation can represent, plus
// which one is active. The active vehicle's id is stamped onto every
// telemetry/fuel/maintenance record at insert time and onto every API
// call, so the server can keep each car's history separate.
//
// Vehicles are few and change rarely, so they live in SharedPreferences
// as JSON instead of Room — no schema migration risk for a config list.
// The id 'default' is reserved by the server for pre-multicar data; a
// fresh install creates an explicit "My Car" profile rather than using
// it, but reads fall back to 'default' if the pref is ever missing so
// an upgraded install keeps posting into its existing history bucket.
data class Vehicle(val id: String, val name: String, var mac: String?)

object VehiclePrefs {

    private const val KEY_VEHICLES = "VEHICLES_JSON"
    private const val KEY_ACTIVE_ID = "ACTIVE_VEHICLE_ID"
    private const val KEY_LEGACY_MAC = "MAC_ADDRESS"
    const val DEFAULT_VEHICLE_ID = "default"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getVehicles(context: Context): List<Vehicle> {
        val raw = prefs(context).getString(KEY_VEHICLES, null)
        val list = mutableListOf<Vehicle>()
        if (raw != null) {
            try {
                val arr = JSONArray(raw)
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val id = o.optString("id")
                    if (id.isNotEmpty()) {
                        list.add(Vehicle(id, o.optString("name"), o.optString("mac", "").ifEmpty { null }))
                    }
                }
            } catch (_: Exception) {
                // Corrupt JSON: rebuild with the default profile below
            }
        }
        if (list.isEmpty()) {
            list.add(Vehicle(DEFAULT_VEHICLE_ID, "My Car", null))
        }
        return list
    }

    private fun saveVehicles(context: Context, vehicles: List<Vehicle>) {
        val arr = JSONArray()
        vehicles.forEach { v ->
            arr.put(JSONObject().apply {
                put("id", v.id)
                put("name", v.name)
                put("mac", v.mac ?: "")
            })
        }
        prefs(context).edit().putString(KEY_VEHICLES, arr.toString()).apply()
    }

    // The active vehicle must always resolve to something in the garage;
    // if the stored id is stale (e.g. after a wipe) fall back to the
    // first profile rather than failing every sync.
    fun getActiveVehicleId(context: Context): String {
        val vehicles = getVehicles(context)
        val active = prefs(context).getString(KEY_ACTIVE_ID, null)
        return if (active != null && vehicles.any { it.id == active }) active else vehicles.first().id
    }

    fun getActiveVehicle(context: Context): Vehicle {
        val activeId = getActiveVehicleId(context)
        return getVehicles(context).first { it.id == activeId }
    }

    fun setActiveVehicle(context: Context, id: String) {
        prefs(context).edit().putString(KEY_ACTIVE_ID, id).apply()
    }

    fun addVehicle(context: Context, name: String, mac: String?): Vehicle {
        val vehicles = getVehicles(context).toMutableList()
        var id: String
        do {
            id = "veh-" + java.util.UUID.randomUUID().toString().substring(0, 8)
        } while (vehicles.any { it.id == id })
        val vehicle = Vehicle(id, name.trim(), mac)
        vehicles.add(vehicle)
        saveVehicles(context, vehicles)
        return vehicle
    }

    fun updateVehicle(context: Context, id: String, name: String? = null, mac: String? = null) {
        val vehicles = getVehicles(context).toMutableList()
        val idx = vehicles.indexOfFirst { it.id == id }
        if (idx == -1) return
        if (name != null) vehicles[idx] = vehicles[idx].copy(name = name.trim())
        if (mac != null) vehicles[idx].mac = mac
        saveVehicles(context, vehicles)
    }

    fun deleteVehicle(context: Context, id: String) {
        val vehicles = getVehicles(context).toMutableList()
        vehicles.removeAll { it.id == id }
        if (vehicles.isEmpty()) vehicles.add(Vehicle(DEFAULT_VEHICLE_ID, "My Car", null))
        saveVehicles(context, vehicles)
        if (getActiveVehicleId(context) == id) setActiveVehicle(context, vehicles.first().id)
    }

    // OBD adapter MAC for the active vehicle. Falls back to the legacy
    // MAC_ADDRESS pref (written by pre-multicar installs) so an upgrade
    // doesn't lose the paired adapter selection.
    fun getActiveAdapterMac(context: Context): String? {
        getActiveVehicle(context).mac?.let { return it }
        return prefs(context).getString(KEY_LEGACY_MAC, null)?.takeIf { it.isNotEmpty() }
    }

    // Persist the adapter selection against the active vehicle (and the
    // legacy key, so an old build re-installed over this one still works).
    fun setActiveAdapterMac(context: Context, mac: String?) {
        val vehicles = getVehicles(context).toMutableList()
        val idx = vehicles.indexOfFirst { it.id == getActiveVehicleId(context) }
        if (idx != -1) {
            vehicles[idx].mac = mac?.takeIf { it.isNotEmpty() }
            saveVehicles(context, vehicles)
        }
        val editor = prefs(context).edit()
        if (mac.isNullOrEmpty()) editor.remove(KEY_LEGACY_MAC) else editor.putString(KEY_LEGACY_MAC, mac)
        editor.apply()
    }
}
