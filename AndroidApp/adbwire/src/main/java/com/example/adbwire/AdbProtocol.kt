package com.example.adbwire

import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

object AdbConstants {
    const val A_SYNC = 0x434e5953
    const val A_CNXN = 0x4e584e43
    const val A_OPEN = 0x4e45504f
    const val A_OKAY = 0x59414b4f
    const val A_CLSE = 0x45534c43
    const val A_WRTE = 0x45545257
    const val A_AUTH = 0x48545541

    const val A_VERSION = 0x01000000
    const val MAX_PAYLOAD = 4096

    fun commandToString(cmd: Int): String = when (cmd) {
        A_SYNC -> "SYNC"
        A_CNXN -> "CNXN"
        A_OPEN -> "OPEN"
        A_OKAY -> "OKAY"
        A_CLSE -> "CLSE"
        A_WRTE -> "WRTE"
        A_AUTH -> "AUTH"
        else -> String.format("0x%08X", cmd)
    }
}

data class AdbMessage(
    val command: Int,
    val arg0: Int,
    val arg1: Int,
    val payload: ByteArray = ByteArray(0)
) {
    fun write(out: OutputStream) {
        val check = payload.fold(0) { acc, b -> acc + (b.toInt() and 0xFF) }
        val magic = command xor -1

        val header = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
        header.putInt(command)
        header.putInt(arg0)
        header.putInt(arg1)
        header.putInt(payload.size)
        header.putInt(check)
        header.putInt(magic)

        synchronized(out) {
            out.write(header.array())
            if (payload.isNotEmpty()) {
                out.write(payload)
            }
            out.flush()
        }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as AdbMessage
        if (command != other.command) return false
        if (arg0 != other.arg0) return false
        if (arg1 != other.arg1) return false
        if (!payload.contentEquals(other.payload)) return false
        return true
    }

    override fun hashCode(): Int {
        var result = command
        result = 31 * result + arg0
        result = 31 * result + arg1
        result = 31 * result + payload.contentHashCode()
        return result
    }

    companion object {
        fun read(input: InputStream): AdbMessage? {
            val headerBytes = ByteArray(24)
            var bytesRead = 0
            while (bytesRead < 24) {
                val r = input.read(headerBytes, bytesRead, 24 - bytesRead)
                if (r == -1) return null
                bytesRead += r
            }

            val buf = ByteBuffer.wrap(headerBytes).order(ByteOrder.LITTLE_ENDIAN)
            val command = buf.int
            val arg0 = buf.int
            val arg1 = buf.int
            val dataLength = buf.int
            val dataCheck = buf.int
            val magic = buf.int

            if ((command xor -1) != magic) {
                return null // Corrupted magic or invalid packet
            }

            val payload = ByteArray(dataLength)
            var payloadRead = 0
            while (payloadRead < dataLength) {
                val r = input.read(payload, payloadRead, dataLength - payloadRead)
                if (r == -1) return null
                payloadRead += r
            }

            return AdbMessage(command, arg0, arg1, payload)
        }
    }
}
