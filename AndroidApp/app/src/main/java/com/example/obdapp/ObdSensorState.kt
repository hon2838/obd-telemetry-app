package com.example.obdapp

/** Connection-scoped OBD sensor cache. Session tokens prevent late reads from
 * a retired connection from repopulating the next connection's cache. */
internal class ObdSensorState(
    private val retryDelayMs: Long = DEFAULT_RETRY_DELAY_MS
) {
    data class Snapshot(
        val coolantTemp: Int?,
        val moduleVoltage: Float?,
        val fuelLevel: Int?,
        val ambientTemp: Int?,
        val intakeAirTemp: Int?,
        val manifoldPressure: Int?,
        val engineLoad: Int?,
        val throttlePosition: Int?,
        val slowPidRetryAfter: List<Long>,
        val engineLoadRetryAfter: Long,
        val throttleRetryAfter: Long,
        val fuelEstimateRetryAfter: Long
    )

    enum class SlowPid(val index: Int) {
        COOLANT(0), MODULE_VOLTAGE(1), FUEL_LEVEL(2), AMBIENT_TEMP(3), INTAKE_AIR_TEMP(4), MANIFOLD_PRESSURE(5)
    }

    private var generation = 0L
    private var connected = false
    private var coolantTemp: Int? = null
    private var moduleVoltage: Float? = null
    private var fuelLevel: Int? = null
    private var ambientTemp: Int? = null
    private var intakeAirTemp: Int? = null
    private var manifoldPressure: Int? = null
    private var engineLoad: Int? = null
    private var throttlePosition: Int? = null
    private val slowPidRetryAfter = LongArray(SlowPid.entries.size)
    private var engineLoadRetryAfter = 0L
    private var throttleRetryAfter = 0L
    private var fuelEstimateRetryAfter = 0L

    init { require(retryDelayMs >= 0L) }

    @Synchronized
    fun beginConnection(): Long {
        clearValuesAndDeadlines()
        generation++
        connected = true
        return generation
    }

    @Synchronized
    fun disconnect() {
        clearValuesAndDeadlines()
        generation++
        connected = false
    }

    @Synchronized
    fun snapshot(session: Long): Snapshot? = if (!connected || generation != session) null else Snapshot(
        coolantTemp, moduleVoltage, fuelLevel, ambientTemp, intakeAirTemp, manifoldPressure,
        engineLoad, throttlePosition, slowPidRetryAfter.toList(), engineLoadRetryAfter,
        throttleRetryAfter, fuelEstimateRetryAfter
    )

    @Synchronized
    fun isCurrentSession(session: Long): Boolean = connected && generation == session

    @Synchronized
    fun updateCoolantTemp(session: Long, value: Int?) = update(session) { coolantTemp = value }
    @Synchronized
    fun updateModuleVoltage(session: Long, value: Float?) = update(session) { moduleVoltage = value }
    @Synchronized
    fun updateFuelLevel(session: Long, value: Int?) = update(session) { fuelLevel = value }
    @Synchronized
    fun updateAmbientTemp(session: Long, value: Int?) = update(session) { ambientTemp = value }
    @Synchronized
    fun updateIntakeAirTemp(session: Long, value: Int?) = update(session) { intakeAirTemp = value }
    @Synchronized
    fun updateManifoldPressure(session: Long, value: Int?) = update(session) { manifoldPressure = value }
    @Synchronized
    fun updateEngineLoad(session: Long, value: Int?) = update(session) { engineLoad = value }
    @Synchronized
    fun updateThrottlePosition(session: Long, value: Int?) = update(session) { throttlePosition = value }

    @Synchronized
    fun deferSlowPid(session: Long, pid: SlowPid, nowElapsedMs: Long): Boolean = update(session) {
        val retryAt = nowElapsedMs + retryDelayMs
        slowPidRetryAfter[pid.index] = retryAt
        when (pid) {
            SlowPid.COOLANT -> coolantTemp = null
            SlowPid.MODULE_VOLTAGE -> moduleVoltage = null
            SlowPid.FUEL_LEVEL -> fuelLevel = null
            SlowPid.AMBIENT_TEMP -> ambientTemp = null
            SlowPid.INTAKE_AIR_TEMP -> intakeAirTemp = null
            SlowPid.MANIFOLD_PRESSURE -> manifoldPressure = null
        }
    }

    @Synchronized
    fun deferEngineLoad(session: Long, nowElapsedMs: Long): Boolean = update(session) {
        engineLoad = null
        engineLoadRetryAfter = nowElapsedMs + retryDelayMs
    }

    @Synchronized
    fun deferThrottlePosition(session: Long, nowElapsedMs: Long): Boolean = update(session) {
        throttlePosition = null
        throttleRetryAfter = nowElapsedMs + retryDelayMs
    }

    @Synchronized
    fun deferFuelEstimate(session: Long, nowElapsedMs: Long): Boolean = update(session) {
        fuelEstimateRetryAfter = nowElapsedMs + retryDelayMs
    }

    private inline fun update(session: Long, block: () -> Unit): Boolean {
        if (!connected || generation != session) return false
        block()
        return true
    }

    private fun clearValuesAndDeadlines() {
        coolantTemp = null
        moduleVoltage = null
        fuelLevel = null
        ambientTemp = null
        intakeAirTemp = null
        manifoldPressure = null
        engineLoad = null
        throttlePosition = null
        slowPidRetryAfter.fill(0L)
        engineLoadRetryAfter = 0L
        throttleRetryAfter = 0L
        fuelEstimateRetryAfter = 0L
    }

    companion object {
        const val DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000L
    }
}
