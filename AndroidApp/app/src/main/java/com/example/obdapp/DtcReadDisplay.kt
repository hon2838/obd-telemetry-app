package com.example.obdapp

import java.util.Locale

internal object DtcReadDisplay {
    private val codePattern = Regex("^[PBCU][0-3][0-9A-F]{3}$")
    data class ReadStatus(val success: Boolean?, val timestamp: Long?, val error: String? = null)
    enum class State { UNKNOWN, FAILED, EMPTY, CODES }
    data class Result(val state: State, val codes: List<String>, val timestamp: Long?,
                      val error: String?, val historical: Boolean)

    fun codes(raw: String): List<String> = raw.trim().split(Regex("[,\\s]+"))
        .map { it.uppercase(Locale.ROOT) }.filter { codePattern.matches(it) }.distinct()

    fun resolve(raw: String, dtcTimestamp: Long?, read: ReadStatus?): Result {
        val text = raw.trim()
        val tokens = text.split(Regex("[,\\s]+")).filter { it.isNotEmpty() }
            .map { it.uppercase(Locale.ROOT) }
        val empty = text.isEmpty() || text.equals("No trouble codes found", true) || text.equals("No DTCs", true)
        val valid = empty || tokens.all { codePattern.matches(it) }
        val confirmed = dtcTimestamp != null && dtcTimestamp > 0 && valid
        val failed = read?.success == false || (dtcTimestamp != null && dtcTimestamp > 0 && !valid)
        val state = when {
            failed -> State.FAILED
            !confirmed -> State.UNKNOWN
            empty -> State.EMPTY
            else -> State.CODES
        }
        return Result(state, if (confirmed) codes(text) else emptyList(),
            read?.timestamp?.takeIf { it > 0 } ?: dtcTimestamp?.takeIf { it > 0 },
            read?.error?.takeIf { it.isNotBlank() } ?: text.takeIf { !valid }, failed && confirmed)
    }
}
