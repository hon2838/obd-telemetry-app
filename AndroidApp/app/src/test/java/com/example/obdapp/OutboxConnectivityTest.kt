package com.example.obdapp

import android.content.Context
import android.net.ConnectivityManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class OutboxConnectivityTest {
    @Test fun replacementAndLateOldCleanupKeepOnlyTheCurrentWakeup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        ReflectionHelpers.setStaticField(OutboxUploader::class.java, "networkCallbackRegistered", false)
        var oldCalls = 0
        var currentCalls = 0
        val oldOwner = OutboxUploader.registerConnectivityCallback(context) { oldCalls++ }
        val currentOwner = OutboxUploader.registerConnectivityCallback(context) { currentCalls++ }
        try {
            val callback = shadowOf(manager).networkCallbacks.single()
            oldOwner.close() // A late destruction must not detach its replacement.
            callback.onAvailable(ShadowNetwork.newInstance(10))
            assertEquals(0, oldCalls)
            assertEquals(1, currentCalls)
            currentOwner.close()
            currentOwner.close()
            callback.onAvailable(ShadowNetwork.newInstance(11))
            assertEquals(0, oldCalls)
            assertEquals(1, currentCalls)
            assertEquals(1, shadowOf(manager).networkCallbacks.size)
        } finally {
            oldOwner.close(); currentOwner.close()
            shadowOf(manager).networkCallbacks.toList().forEach { manager.unregisterNetworkCallback(it) }
            ReflectionHelpers.setStaticField(OutboxUploader::class.java, "networkCallbackRegistered", false)
        }
    }
}
