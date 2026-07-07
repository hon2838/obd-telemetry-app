package com.example.obdapp

import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun testStartAndStopButtonsDisplayed() {
        onView(withId(R.id.btnStart)).check(matches(isDisplayed()))
        onView(withId(R.id.btnStop)).check(matches(isDisplayed()))
        onView(withText("Start Service")).check(matches(isDisplayed()))
        onView(withText("Stop Service")).check(matches(isDisplayed()))
    }

    @Test
    fun testFuelLogSectionDisplayed() {
        onView(withText("FUEL LOG")).check(matches(isDisplayed()))
        onView(withId(R.id.etFuelLitres)).check(matches(isDisplayed()))
        onView(withId(R.id.etFuelOdometer)).check(matches(isDisplayed()))
        onView(withId(R.id.btnLogFuel)).check(matches(isDisplayed()))
    }

    @Test
    fun testStatusCardDisplaysCorrectly() {
        onView(withText("GATEWAY SERVICE STATUS")).check(matches(isDisplayed()))
        onView(withId(R.id.statusText)).check(matches(withText("Service Stopped")))
    }
}
