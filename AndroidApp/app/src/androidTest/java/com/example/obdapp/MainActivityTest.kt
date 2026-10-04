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

        override fun before() {
            val target = ApplicationProvider.getApplicationContext<Context>()
            if (target.packageName != "com.example.obdapp.androidauto") return
            context = target
            val prefs = target.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            hadUrl = prefs.contains(KEY_API_BASE_URL)
            originalUrl = prefs.getString(KEY_API_BASE_URL, null)
            // Fresh-install pairing must not create test requests on the live API.
            saveApiBaseUrl(target, "http://127.0.0.1:9")
        }

        override fun after() {
            val target = context ?: return
            val editor = target.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            if (hadUrl) editor.putString(KEY_API_BASE_URL, originalUrl)
            else editor.remove(KEY_API_BASE_URL)
            editor.commit()
        }
    }

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(isolatedPhoneApi)
        .around(ActivityScenarioRule(MainActivity::class.java))

    @Before
    fun dismissPairingDialogIfShown() {
        // Fresh installs show a blocking "Pair Head Unit with Account" dialog.
        // Dismiss it so the underlying ScrollView content can be asserted.
        // Production UI is unchanged; this only drives the test's own activity.
        try {
            onView(withText("Cancel")).inRoot(isDialog()).perform(click())
        } catch (_: NoMatchingRootException) {
            // An already configured app has no pairing dialog.
        } catch (_: NoMatchingViewException) {
            // No cancel button exists when no pairing dialog is shown.
        }
    }

    @Test
    fun testStartAndStopButtonsDisplayed() {
        onView(withId(R.id.btnStart)).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withId(R.id.btnStop)).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withText("Start Service")).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withText("Stop Service")).perform(scrollTo()).check(matches(isDisplayed()))
    }

    @Test
    fun testFuelLogSectionDisplayed() {
        onView(withText("FUEL LOG")).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withId(R.id.etFuelLitres)).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withId(R.id.etFuelOdometer)).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withId(R.id.btnLogFuel)).perform(scrollTo()).check(matches(isDisplayed()))
    }

    @Test
    fun testStatusCardDisplaysCorrectly() {
        onView(withText("GATEWAY SERVICE STATUS")).perform(scrollTo()).check(matches(isDisplayed()))
        onView(withId(R.id.statusText)).perform(scrollTo()).check(matches(withText("Service Stopped")))
    }
}
