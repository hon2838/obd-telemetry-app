package com.example.obdapp

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class HttpResponse(
    val statusCode: Int,
    val body: String,
    val isSuccess: Boolean
)

object HttpTransport {

    const val DEFAULT_CONNECT_TIMEOUT_MS = 10_000
    const val DEFAULT_READ_TIMEOUT_MS = 15_000
    const val DEFAULT_OVERALL_TIMEOUT_MS = 45_000L

    // HttpURLConnection performs blocking I/O that may not return immediately
    // when its coroutine is cancelled. Keep the worker outside the caller's
    // Job so withTimeout can complete promptly; invokeOnCancellation below
    // still disconnects the socket and cancels this supervised worker.
    private val transportScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    suspend fun postJson(
        urlString: String,
        jsonPayload: String,
        context: Context,
        connectTimeoutMs: Int = DEFAULT_CONNECT_TIMEOUT_MS,
        readTimeoutMs: Int = DEFAULT_READ_TIMEOUT_MS,
        overallTimeoutMs: Long = DEFAULT_OVERALL_TIMEOUT_MS
    ): HttpResponse = withTimeout(overallTimeoutMs) {
        suspendCancellableCoroutine { continuation ->
            val connectionRef = java.util.concurrent.atomic.AtomicReference<HttpURLConnection?>(null)
            val isCompleted = java.util.concurrent.atomic.AtomicBoolean(false)

            val workerJob = transportScope.launch {
                try {
                    val url = URL(urlString)
                    val conn = (url.openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        setRequestProperty("Content-Type", "application/json")
                        setRequestProperty("Accept", "application/json")
                        applyAuthHeader(this, context)
                        doOutput = true
                        connectTimeout = connectTimeoutMs
                        readTimeout = readTimeoutMs
                    }
                    connectionRef.set(conn)

                    if (!continuation.isActive || isCompleted.get()) {
                        connectionRef.getAndSet(null)?.let {
                            try { it.disconnect() } catch (_: Throwable) {}
                        }
                        return@launch
                    }

                    OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                        writer.write(jsonPayload)
                        writer.flush()
                    }

                    if (!continuation.isActive || isCompleted.get()) {
                        connectionRef.getAndSet(null)?.let {
                            try { it.disconnect() } catch (_: Throwable) {}
                        }
                        return@launch
                    }

                    val statusCode = conn.responseCode
                    val isSuccess = statusCode in 200..299
                    val stream = if (isSuccess) conn.inputStream else conn.errorStream
                    val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""

                    if (continuation.isActive && isCompleted.compareAndSet(false, true)) {
                        continuation.resume(HttpResponse(statusCode, body, isSuccess))
                    }
                } catch (e: Throwable) {
                    if (e is CancellationException) {
                        isCompleted.set(true)
                    } else if (continuation.isActive && isCompleted.compareAndSet(false, true)) {
                        continuation.resumeWithException(e)
                    }
                } finally {
                    connectionRef.getAndSet(null)?.let { conn ->
                        try { conn.disconnect() } catch (_: Throwable) {}
                    }
                }
            }

            continuation.invokeOnCancellation {
                isCompleted.set(true)
                val connectionToClose = connectionRef.getAndSet(null)
                if (connectionToClose != null) {
                    // Some HttpURLConnection implementations block inside
                    // disconnect() while a read is active. Never run that
                    // teardown on the timeout/cancellation callback thread.
                    transportScope.launch {
                        try { connectionToClose.disconnect() } catch (_: Throwable) {}
                    }
                }
                workerJob.cancel()
            }
        }
    }
}
