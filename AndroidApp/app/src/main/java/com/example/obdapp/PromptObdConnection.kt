package com.example.obdapp

import com.github.eltonvs.obd.command.ObdCommand
import com.github.eltonvs.obd.command.ObdRawResponse
import com.github.eltonvs.obd.command.ObdResponse
import com.github.eltonvs.obd.command.NoDataException
import com.github.eltonvs.obd.command.UnSupportedCommandException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** Serial transactions finish at the ELM prompt, without the library's 500 ms read sleeps. */
internal class PromptObdConnection(
    private val input: InputStream,
    private val output: OutputStream,
    private val timeoutMs: Long = 5_000L,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO
) {
    private val mutex = Mutex()
    private var usable = true
    private var responseCountEnabled = false
    private val responseCounts = mutableMapOf<String, Int>()
    private var batchEnabled = false

    /** Enable only for discovered standard OBD protocols; retain full replies for unknown protocols. */
    fun configureResponseCount(protocolReply: String) {
        responseCountEnabled = Regex("A?[1-9]", RegexOption.IGNORE_CASE).matches(protocolReply.trim())
        responseCounts.clear()
        batchEnabled = Regex("A?[6-9]", RegexOption.IGNORE_CASE).matches(protocolReply.trim())
    }

    /** CAN supports up to six PIDs per request; unsupported vehicles fall back for this connection. */
    suspend fun runBatch(commands: List<ObdCommand>): Map<String, ObdRawResponse>? {
        if (!batchEnabled || commands.size !in 2..6 || commands.any { it.mode != "01" || it.pid !in ObdBatchReply.lengths } ||
            commands.map { it.pid }.distinct().size != commands.size) return null
        val raw = try {
            run(BatchPidCommand(commands.map { it.pid })).rawResponse
        } catch (_: NoDataException) {
            batchEnabled = false
            return null
        } catch (_: UnSupportedCommandException) {
            batchEnabled = false
            return null
        }
        val decoded = try {
            ObdBatchReply.decode(raw, commands.map { it.pid })
        } catch (_: IOException) {
            batchEnabled = false
            return null
        }
        return decoded
    }

    init {
        require(timeoutMs > 0)
    }

    suspend fun run(command: ObdCommand): ObdResponse = withContext(ioDispatcher) {
        mutex.withLock {
            checkUsable()
            val start = System.nanoTime()
            val reply = try {
                currentCoroutineContext().ensureActive()
                // Learn the actual ECU reply count from an ordinary full response
                // before enabling this optimization for each fixed-length sensor PID.
                // The trailing count avoids waiting for additional ECU replies;
                // diagnostics, initialization and unknown protocols keep full replies.
                val pid = command.pid.uppercase()
                val count = if (responseCountEnabled && command.mode == "01") responseCounts[pid] else null
                val response = transact(command.rawCommand + if (count != null) " ${count.toString(16)}" else "", start)
                if (count != null && response == "?") {
                    // Older/clone adapters can reject the count syntax. A complete
                    // prompt makes retrying the ordinary read safe; never retry DTC actions.
                    responseCountEnabled = false
                    responseCounts.clear()
                    transact(command.rawCommand, System.nanoTime())
                } else {
                    if (count == null && responseCountEnabled && command.mode == "01") learnReplyCount(pid, response)
                    response
                }
            } catch (error: CancellationException) {
                // A partial frame may arrive later. Never attribute it to another command.
                usable = false
                throw error
            } catch (error: IOException) {
                usable = false
                throw error
            }
            // A complete NO DATA / unsupported response leaves the stream synchronized.
            command.handleResponse(ObdRawResponse(reply, (System.nanoTime() - start) / 1_000_000L))
        }
    }

    private fun checkUsable() {
        if (!usable) throw IOException("OBD stream must reconnect after an interrupted response")
    }

    private suspend fun transact(request: String, startNanos: Long): String {
        output.write((request + "\r").toByteArray(Charsets.US_ASCII))
        output.flush()
        return readReply(startNanos)
    }

    private fun learnReplyCount(pid: String, reply: String) {
        val payloadLength = SINGLE_FRAME_PIDS[pid] ?: return
        val frames = reply.lineSequence().map { line ->
            line.filterNot { it.isWhitespace() }.uppercase()
        }.filter { it.isNotEmpty() }.toList()
        // Refuse to count echoed commands, headers, fragmented messages,
        // error text or mixed PID replies. Multiple ECU replies remain included.
        if (frames.size in 1..15 && frames.all { frame ->
                frame.startsWith("41$pid") && frame.length == 4 + payloadLength * 2 &&
                    frame.all { it in '0'..'9' || it in 'A'..'F' }
            }) responseCounts[pid] = frames.size
    }

    private suspend fun readReply(startNanos: Long): String {
        val response = StringBuilder()
        while ((System.nanoTime() - startNanos) / 1_000_000L < timeoutMs) {
            currentCoroutineContext().ensureActive()
            if (input.available() <= 0) {
                delay(5L)
                continue
            }
            val next = input.read()
            if (next < 0) throw IOException("OBD stream closed before the prompt")
            if (next == '>'.code) return response.toString().trim()
            if (response.length >= 16_384) throw IOException("OBD response exceeds the frame limit")
            response.append(next.toChar())
        }
        throw IOException("OBD response timed out before the prompt")
    }

    companion object {
        private val SINGLE_FRAME_PIDS = mapOf(
            "03" to 2, "04" to 1, "05" to 1, "0B" to 1, "0C" to 2, "0D" to 1,
            "0F" to 1, "10" to 2, "11" to 1, "2F" to 1, "42" to 2, "45" to 1, "46" to 1
        )
    }
}
