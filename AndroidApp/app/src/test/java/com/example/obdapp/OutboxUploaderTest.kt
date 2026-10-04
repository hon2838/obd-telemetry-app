package com.example.obdapp

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.NetworkInfo
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetworkInfo
import org.robolectric.util.ReflectionHelpers
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class OutboxUploaderTest {
    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private val serverFailure = AtomicReference<Throwable?>()
    private val uploadedVehicles = CopyOnWriteArrayList<String>()
    private val uploadedTelemetry = CopyOnWriteArrayList<JSONObject>()
    @Volatile private var failingVehicle = "b"
    @Volatile private var failureCode = 200

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
        GatewayStatusStore.setRunning(false)
        VehiclePrefs.addVehicle(context, "Car A", null, "a")
        VehiclePrefs.setActiveVehicle(context, "a")
        saveApiKey(context, "local-test-key")

        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val shadowConnectivity = shadowOf(connectivity)
        shadowConnectivity.setActiveNetworkInfo(ShadowNetworkInfo.newInstance(
            NetworkInfo.DetailedState.CONNECTED, ConnectivityManager.TYPE_WIFI, 0, true, true
        ))
        val capabilities = NetworkCapabilities()
        shadowOf(capabilities).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowConnectivity.setNetworkCapabilities(connectivity.activeNetwork, capabilities)
        assertTrue(OutboxUploader.isNetworkAvailable(context))

        db = AppDatabase.getDatabase(context)
        runBlocking(Dispatchers.IO) { db.clearAllTables() }
        server = ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1"))
        serverThread = thread(isDaemon = true, name = "outbox-test-server") {
            try {
                while (!server.isClosed) {
                    server.accept().use { client ->
                        client.soTimeout = 5_000
                        val reader = client.getInputStream().bufferedReader(Charsets.UTF_8)
                        val requestLine = reader.readLine()
                        var contentLength = 0
                        while (true) {
                            val header = reader.readLine() ?: break
                            if (header.isEmpty()) break
                            if (header.startsWith("Content-Length:", ignoreCase = true)) {
                                contentLength = header.substringAfter(':').trim().toInt()
                            }
                        }
                        val body = CharArray(contentLength)
                        var offset = 0
                        while (offset < body.size) {
                            val read = reader.read(body, offset, body.size - offset)
                            check(read > 0) { "Request body ended early" }
                            offset += read
                        }
                        val (code, response) = responseFor(requestLine, String(body))
                        val bytes = response.toByteArray(Charsets.UTF_8)
                        client.getOutputStream().apply {
                            write(("HTTP/1.1 $code Test\r\nContent-Type: application/json\r\n" +
                                "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n")
                                .toByteArray(Charsets.UTF_8))
                            write(bytes)
                            flush()
                        }
                    }
                }
            } catch (e: SocketException) {
                if (!server.isClosed) serverFailure.set(e)
            } catch (e: Throwable) {
                serverFailure.set(e)
            }
        }
        saveApiBaseUrl(context, "http://127.0.0.1:${server.localPort}")
    }

    @After
    fun tearDown() {
        if (::server.isInitialized) server.close()
        if (::serverThread.isInitialized) serverThread.join(5_000)
        if (::db.isInitialized) {
            runBlocking(Dispatchers.IO) { db.clearAllTables() }
            db.close()
        }
        ReflectionHelpers.setStaticField(AppDatabase::class.java, "INSTANCE", null)
        if (::context.isInitialized) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
            context.deleteDatabase("obd_telemetry_database")
        }
        OutboxUploader.commandHandler = null
        GatewayStatusStore.setRunning(false)
        assertNull("Loopback server failed", serverFailure.get())
        if (::serverThread.isInitialized) assertFalse("Loopback server did not stop", serverThread.isAlive)
    }

    private fun responseFor(requestLine: String, body: String): Pair<Int, String> {
        if (requestLine.startsWith("GET ")) return 200 to """{"commands":[]}"""
        val batch = JSONArray(body)
        if (requestLine.contains("/api/telemetry/batch")) {
            for (index in 0 until batch.length()) uploadedTelemetry.add(batch.getJSONObject(index))
        }
        val vehicle = batch.getJSONObject(0).getString("vehicleId")
        uploadedVehicles.add(vehicle)
        // A 2xx response with no event acknowledgments is incompatible.
        if (vehicle == failingVehicle) return failureCode to "{}"
        val acceptedIds = JSONArray()
        for (index in 0 until batch.length()) {
            acceptedIds.put(batch.getJSONObject(index).getString("eventId"))
        }
        return 200 to JSONObject().put("acceptedIds", acceptedIds).toString()
    }

    @Test
    fun inactiveFuelIncompatibilityDoesNotOverwriteActiveVehicleSuccess() = runBlocking(Dispatchers.IO) {
        insertFuel("a")
        insertFuel("b")
        insertFuel("c")

        val report = OutboxUploader.drainOutbox(context)

        assertSyncState(GatewaySyncState.SYNCED)
        assertTrue(report.hadSuccess)
        assertTrue(report.hadIncompatibleServer)
        assertFalse(report.hadNetworkFailures)
        assertEquals(2, report.totalAckedFuel)
        assertEquals(0, db.fuelLogDao().countUnsyncedForVehicle("a"))
        assertEquals(listOf("fuel-b"), db.fuelLogDao().getUnsyncedLogsForVehicle("b").map { it.eventId })
        assertEquals(0, db.fuelLogDao().countUnsyncedForVehicle("c"))
        assertEquals("a", uploadedVehicles.first())
        assertEquals(setOf("b", "c"), uploadedVehicles.drop(1).toSet())
    }

    @Test
    fun inactiveNetworkFailurePreservesActiveMaintenanceSuccessAndGlobalBackoff() = runBlocking(Dispatchers.IO) {
        failureCode = 503
        insertMaintenance("a")
        // Fuel vehicles are collected before maintenance vehicles, so B
        // precedes C without relying on unordered DISTINCT query results.
        insertFuel("b")
        insertMaintenance("c")

        val report = OutboxUploader.drainOutbox(context)

        assertSyncState(GatewaySyncState.SYNCED)
        assertTrue(report.hadSuccess)
        assertTrue(report.hadNetworkFailures)
        assertFalse(report.hadIncompatibleServer)
        assertEquals(1, report.totalAckedMaint)
        assertEquals(0, db.maintenanceDao().countUnsyncedForVehicle("a"))
        assertEquals(1, db.fuelLogDao().countUnsyncedForVehicle("b"))
        assertEquals(1, db.maintenanceDao().countUnsyncedForVehicle("c"))
        assertEquals(listOf("a", "b"), uploadedVehicles.toList())
    }

    @Test
    fun activeTelemetryIncompatibilityRemainsErrorWhenAnotherVehicleSucceeds() = runBlocking(Dispatchers.IO) {
        failingVehicle = "a"
        insertTelemetry("a")
        insertTelemetry("b")

        val report = OutboxUploader.drainOutbox(context)

        assertSyncState(GatewaySyncState.ERROR)
        assertTrue(report.hadIncompatibleServer)
        assertTrue(report.hadSuccess)
        assertEquals(1, report.totalAckedTelemetry)
        assertEquals(listOf("telemetry-a"), db.telemetryDao().getUnsyncedRecordsForVehicle("a").map { it.eventId })
        assertEquals(0, db.telemetryDao().countUnsyncedForVehicle("b"))
    }

    @Test
    fun activeFuelNetworkFailureRemainsErrorAndStopsOtherVehicles() = runBlocking(Dispatchers.IO) {
        failingVehicle = "a"
        failureCode = 503
        insertFuel("a")
        insertFuel("b")

        val report = OutboxUploader.drainOutbox(context)

        assertSyncState(GatewaySyncState.ERROR)
        assertTrue(report.hadNetworkFailures)
        assertFalse(report.hadSuccess)
        assertEquals(0, report.totalAckedFuel)
        assertEquals(1, db.fuelLogDao().countUnsyncedForVehicle("a"))
        assertEquals(1, db.fuelLogDao().countUnsyncedForVehicle("b"))
        assertEquals(listOf("a"), uploadedVehicles.toList())
    }

    @Test
    fun activeMaintenanceValidationFailureRemainsErrorAndRetainsRejectedRows() = runBlocking(Dispatchers.IO) {
        failingVehicle = "a"
        failureCode = 422
        insertMaintenance("a")
        insertMaintenance("b")

        val report = OutboxUploader.drainOutbox(context)

        assertSyncState(GatewaySyncState.ERROR)
        assertEquals(setOf("a"), report.quarantinedVehicles)
        assertEquals(1, report.quarantinedCount)
        assertEquals(1, db.maintenanceDao().countUnsyncedForVehicle("a"))
        assertEquals(0, db.maintenanceDao().countUnsyncedForVehicle("b"))
    }

    @Test
    fun activeFuelAuthFailureRemainsErrorAndAllowsOtherVehiclesToDrain() = runBlocking(Dispatchers.IO) {
        failingVehicle = "a"
        failureCode = 403
        insertFuel("a")
        insertFuel("b")

        val report = OutboxUploader.drainOutbox(context)

        assertSyncState(GatewaySyncState.ERROR)
        assertEquals(setOf("a"), report.blockedVehicles)
        assertEquals(1, db.fuelLogDao().countUnsyncedForVehicle("a"))
        assertEquals(0, db.fuelLogDao().countUnsyncedForVehicle("b"))
    }

    private fun assertSyncState(expected: GatewaySyncState) {
        assertEquals("a", GatewayStatusStore.status.value.syncVehicleId)
        assertEquals(expected, GatewayStatusStore.status.value.syncState)
    }

    private suspend fun insertFuel(vehicle: String) {
        db.fuelLogDao().insert(FuelLogEntity(
            eventId = "fuel-$vehicle", timestamp = 1L, litres = 10.0, odometer = 100.0, vehicleId = vehicle
        ))
    }

    private suspend fun insertMaintenance(vehicle: String) {
        db.maintenanceDao().insert(MaintenanceEntity(
            eventId = "maintenance-$vehicle", serverId = "service-$vehicle", name = "Oil",
            intervalKm = null, intervalDays = null, lastServiceOdo = null, lastServiceDate = null,
            vehicleId = vehicle
        ))
    }

    @Test
    fun uploadsFuelEstimateAndIdleZeroWithoutLosingLegacyNulls() = runBlocking(Dispatchers.IO) {
        failingVehicle = "none"
        insertTelemetry("a")
        val original = db.telemetryDao().getUnsyncedRecordsForVehicle("a").single()
        db.telemetryDao().insert(original.copy(
            id = 0, eventId = "fuel-estimate", mafGps = 3.24,
            fuelSystemStatus = 2, estimatedFuelRateLph = 1.057959184,
            estimatedFuelEconomyKmL = 0.0
        ))
        OutboxUploader.drainOutbox(context)
        val sent = uploadedTelemetry.first { it.getString("eventId") == "fuel-estimate" }
        assertEquals(3.24, sent.getDouble("mafGps"), 0.0)
        assertEquals(2, sent.getInt("fuelSystemStatus"))
        assertEquals(1.057959184, sent.getDouble("estimatedFuelRateLph"), 0.0)
        assertEquals(0.0, sent.getDouble("estimatedFuelEconomyKmL"), 0.0)
        assertTrue(uploadedTelemetry.first { it.getString("eventId") == "telemetry-a" }.isNull("estimatedFuelEconomyKmL"))
        assertEquals(0, db.telemetryDao().countUnsyncedForVehicle("a"))
    }

    private suspend fun insertTelemetry(vehicle: String) {
        db.telemetryDao().insert(TelemetryEntity(
            eventId = "telemetry-$vehicle", timestamp = 1L, rpm = null, speed = null, coolantTemp = null,
            latitude = 0.0, longitude = 0.0, altitude = 0.0, gpsSpeed = 0f, engineLoad = null,
            throttlePos = null, fuelLevel = null, ambientTemp = null, voltage = null, vehicleId = vehicle
        ))
    }
}
