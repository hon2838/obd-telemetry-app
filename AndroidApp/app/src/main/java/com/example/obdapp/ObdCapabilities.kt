package com.example.obdapp

/**
 * Encapsulates discovered Mode 01 PID capabilities from the vehicle.
 * Masks are bit-encoded per SAE J1979:
 * 01 00 (PIDs 0x01–0x20), 01 20 (PIDs 0x21–0x40), 01 40 (PIDs 0x41–0x60).
 */
data class ObdCapabilities(
    val supportedPids: Set<Int> = emptySet()
) {
    fun isSupported(pid: Int): Boolean = supportedPids.contains(pid)

    fun hasCapabilities(): Boolean = supportedPids.isNotEmpty()

    companion object {
        val EMPTY = ObdCapabilities(emptySet())

        /**
         * Parses a Mode 01 PID mask frame (e.g. "41 00 BE 3F B8 13", "41 20 80 04 20 01").
         * Returns the set of PIDs identified as supported by this 4-byte mask frame.
         */
        fun parseMask(rawHex: String): Set<Int> {
            val match = Regex(
                "41\\s*([0-9A-F]{2})\\s*([0-9A-F]{2})\\s*([0-9A-F]{2})\\s*([0-9A-F]{2})\\s*([0-9A-F]{2})",
                RegexOption.IGNORE_CASE
            ).find(rawHex) ?: return emptySet()

            val basePid = match.groupValues[1].toInt(16)
            val bytes = intArrayOf(
                match.groupValues[2].toInt(16),
                match.groupValues[3].toInt(16),
                match.groupValues[4].toInt(16),
                match.groupValues[5].toInt(16)
            )

            val pids = mutableSetOf<Int>()
            for (byteIndex in 0 until 4) {
                val b = bytes[byteIndex]
                for (bit in 7 downTo 0) {
                    if ((b and (1 shl bit)) != 0) {
                        val pid = basePid + (byteIndex * 8) + (7 - bit) + 1
                        pids.add(pid)
                    }
                }
            }
            return pids
        }
    }
}
