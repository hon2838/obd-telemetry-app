package com.example.obdapp

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class HttpTransportTest {

    private fun context(): Context = ApplicationProvider.getApplicationContext()

    @Test
    fun postJson_completesSuccessfullyOnValidServerResponse() = runBlocking {
        val server = ServerSocket(0)
        val port = server.localPort

        val serverThread = thread {
            val client = server.accept()
            val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))
            val lines = mutableListOf<String>()
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                if (line.isNullOrEmpty()) break
                lines.add(line!!)
            }
            // Read body
            val contentLength = lines.find { it.startsWith("Content-Length:", ignoreCase = true) }
                ?.substringAfter(":")?.trim()?.toIntOrNull() ?: 0
            val bodyChars = CharArray(contentLength)
            if (contentLength > 0) {
                reader.read(bodyChars, 0, contentLength)
            }
            val body = String(bodyChars)

            val out = OutputStreamWriter(client.getOutputStream(), Charsets.UTF_8)
            val responseBody = """{"status":"ok","received":$body}"""
            out.write("HTTP/1.1 200 OK\r\n")
            out.write("Content-Type: application/json\r\n")
            out.write("Content-Length: ${responseBody.toByteArray(Charsets.UTF_8).size}\r\n")
            out.write("Connection: close\r\n\r\n")
            out.write(responseBody)
            out.flush()
            client.close()
            server.close()
        }

        val resp = HttpTransport.postJson(
            urlString = "http://127.0.0.1:$port/test",
            jsonPayload = """{"key":"value"}""",
            context = context(),
            connectTimeoutMs = 2000,
            readTimeoutMs = 2000,
            overallTimeoutMs = 5000L
        )

        serverThread.join(3000)
        assertTrue(resp.isSuccess)
        assertEquals(200, resp.statusCode)
        assertTrue(resp.body.contains(""""status":"ok""""))
    }

    @Test
    fun postJson_cancelsActivelyOnSlowTrickleResponse() = runBlocking {
        val server = ServerSocket(0)
        val port = server.localPort
        val serverThread = thread {
            try {
                val client = server.accept()
                val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    if (line.isNullOrEmpty()) break
                }

                val out = client.getOutputStream()
                out.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n".toByteArray(Charsets.UTF_8))
                out.flush()

                // Trickle: send 1 byte, then wait.
                // Read timeout is set high (5000ms), but overall timeout is short (300ms).
                out.write("1\r\na\r\n".toByteArray(Charsets.UTF_8))
                out.flush()

                try {
                    Thread.sleep(2000)
                } catch (_: InterruptedException) {}

                try {
                    client.close()
                } catch (_: Exception) {}
            } catch (_: Exception) {
            } finally {
                server.close()
            }
        }

        val startTime = System.currentTimeMillis()
        var timedOut = false
        try {
            HttpTransport.postJson(
                urlString = "http://127.0.0.1:$port/trickle",
                jsonPayload = "{}",
                context = context(),
                connectTimeoutMs = 5000,
                readTimeoutMs = 5000,
                overallTimeoutMs = 300L
            )
        } catch (e: TimeoutCancellationException) {
            timedOut = true
        }

        val elapsed = System.currentTimeMillis() - startTime
        serverThread.join(3000)

        assertTrue("Expected TimeoutCancellationException", timedOut)
        // The mock server closes naturally after two seconds. Requiring the
        // call to return within 1.2 seconds proves the overall timeout actively
        // disconnected the blocking read instead of waiting for that close.
        assertTrue("Expected active cancellation near 300ms, elapsed: $elapsed ms", elapsed < 1200)
    }

    @Test
    fun postJson_activelyDisconnectsOnCallerJobCancellation() = runBlocking {
        val server = ServerSocket(0)
        val port = server.localPort
        val requestReceivedLatch = CountDownLatch(1)
        val disconnectedLatch = CountDownLatch(1)

        val serverThread = thread {
            try {
                val client = server.accept()
                requestReceivedLatch.countDown()
                try {
                    val stream = client.getInputStream()
                    val b = ByteArray(64)
                    while (stream.read(b) != -1) {
                        // wait for disconnect
                    }
                    disconnectedLatch.countDown()
                } catch (_: Exception) {
                    disconnectedLatch.countDown()
                }
                client.close()
            } finally {
                server.close()
            }
        }

        val job = launch(Dispatchers.IO) {
            HttpTransport.postJson(
                urlString = "http://127.0.0.1:$port/hang",
                jsonPayload = "{}",
                context = context(),
                connectTimeoutMs = 5000,
                readTimeoutMs = 5000,
                overallTimeoutMs = 10000L
            )
        }

        assertTrue(requestReceivedLatch.await(3, TimeUnit.SECONDS))
        job.cancel()

        val disconnected = disconnectedLatch.await(3, TimeUnit.SECONDS)
        serverThread.join(3000)

        assertTrue("Expected socket to be actively disconnected upon cancellation", disconnected)
    }
}
