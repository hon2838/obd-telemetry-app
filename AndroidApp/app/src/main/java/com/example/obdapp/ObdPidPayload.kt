package com.example.obdapp

import com.github.eltonvs.obd.command.ObdRawResponse
import java.io.IOException

internal fun obdPidPayload(response: ObdRawResponse, pid: Int, length: Int): IntArray {
    val frame = response.bufferedValue
    if (frame.size < length + 2 || frame[0] != 0x41 || frame[1] != pid) {
        throw IOException("Incomplete or mismatched OBD PID response")
    }
    return frame.copyOfRange(2, 2 + length)
}
