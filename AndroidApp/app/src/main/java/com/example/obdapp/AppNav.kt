package com.example.obdapp

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.widget.TextView

// Shared pill navigation across app pages. Add a Page entry + a pill in
// view_nav_bar.xml, then call AppNav.setup(activity, page) in onCreate.
object AppNav {

    enum class Page { GATEWAY, DIAGNOSTICS, TRIPS }

    fun setup(activity: Activity, current: Page) {
        bind(activity, current, Page.GATEWAY, R.id.navGateway, MainActivity::class.java)
        bind(activity, current, Page.DIAGNOSTICS, R.id.navDiagnostics, DiagnosticsActivity::class.java)
        bind(activity, current, Page.TRIPS, R.id.navTrips, TripsActivity::class.java)
    }

    private fun bind(activity: Activity, current: Page, page: Page, pillId: Int, target: Class<*>) {
        val pill = activity.findViewById<TextView>(pillId) ?: return
        val active = page == current
        pill.setBackgroundResource(if (active) R.drawable.nav_pill_active else R.drawable.nav_pill_inactive)
        pill.setTextColor(if (active) Color.parseColor("#5ED7D0") else Color.parseColor("#AEAEB2"))
        pill.setOnClickListener {
            if (!active) activity.startActivity(Intent(activity, target))
        }
    }
}
