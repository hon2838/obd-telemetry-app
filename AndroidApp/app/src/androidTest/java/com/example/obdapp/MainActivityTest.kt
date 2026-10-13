package com.example.obdapp

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.NoMatchingRootException
import androidx.test.espresso.NoMatchingViewException
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.scrollTo
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain

@RunWith(AndroidJUnit4::class)
class MainActivityTest {

    private val isolatedPhoneApi = object : ExternalResource() {
        private var context: Context? = null
        private var hadUrl = false
        private var originalUrl: String? = null
        private var hadToken = false
        private var originalToken: String? = null

        override fun before() {
            val target = ApplicationProvider.getApplicationContext<Context>()
            context = target
            val prefs = target.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            hadUrl = prefs.contains(KEY_API_BASE_URL)
            originalUrl = prefs.getString(KEY_API_BASE_URL, null)
            hadToken = prefs.contains(KEY_DEVICE_TOKEN)
            originalToken = prefs.getString(KEY_DEVICE_TOKEN, null)

            // Fresh-install pairing and live requests must be suppressed in tests.
            saveApiBaseUrl(target, "http://127.0.0.1:9")
            saveDeviceToken(target, "test-instrumentation-token")
        }

        override fun after() {
            val target = context ?: return
            val editor = target.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            if (hadUrl) editor.putString(KEY_API_BASE_URL, originalUrl)
            else editor.remove(KEY_API_BASE_URL)

            if (hadToken) editor.putString(KEY_DEVICE_TOKEN, originalToken)
            else editor.remove(KEY_DEVICE_TOKEN)
            editor.commit()
        }
    }

    @get:Rule(order = 0)
    val permissionRule: androidx.test.rule.GrantPermissionRule =
        androidx.test.rule.GrantPermissionRule.grant(
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.ACCESS_COARSE_LOCATION,
            android.Manifest.permission.ACCESS_BACKGROUND_LOCATION
        )

    private val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @get:Rule(order = 1)
    val rules: RuleChain = RuleChain.outerRule(isolatedPhoneApi)
        .around(activityRule)

    @Before
    fun dismissPairingDialogIfShown() {
        // Fresh installs show a blocking "Pair Head Unit with Account" dialog.
        try {
            onView(withText("Cancel")).inRoot(isDialog()).perform(click())
        } catch (_: Exception) {
        }

        // Open controls drawer in landscape or expand settings in portrait directly on UI thread
        activityRule.scenario.onActivity { activity ->
            activity.findViewById<androidx.drawerlayout.widget.DrawerLayout>(R.id.drawerLayout)?.let { drawer ->
                drawer.openDrawer(androidx.core.view.GravityCompat.START, false)
            }
            activity.findViewById<android.view.View>(R.id.settingsContainer)?.visibility = android.view.View.VISIBLE
        }
    }

    @Test
    fun testStartAndStopButtonsDisplayed() {
        onView(withId(R.id.btnStart)).check(matches(isDisplayed()))
        onView(withId(R.id.btnStop)).check(matches(isDisplayed()))
    }

    @Test
    fun testFuelLogSectionDisplayed() {
        onView(withId(R.id.btnLogFuel)).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withId(R.id.etFuelLitres)).check(matches(isDisplayed()))
        onView(withId(R.id.etFuelOdometer)).check(matches(isDisplayed()))
    }

    @Test
    fun testStatusCardDisplaysCorrectly() {
        onView(withId(R.id.statusIndicator)).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withId(R.id.statusText)).check(matches(isDisplayed()))
    }
}
