package com.example.obdapp

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.ImageButton
import android.widget.TextView
import androidx.appcompat.widget.PopupMenu
import androidx.core.content.ContextCompat

// Shared pill and hamburger navigation across app pages. Add a Page entry + a pill in
// view_nav_bar.xml, then call AppNav.setup(activity, page) in onCreate.
object AppNav {

    enum class Page(val title: String, val menuStringRes: Int, val targetClass: Class<*>) {
        GATEWAY("GATEWAY", R.string.nav_gateway, MainActivity::class.java),
        DIAGNOSTICS("DIAGNOSTICS", R.string.nav_diagnostics, DiagnosticsActivity::class.java),
        TRIPS("TRIPS", R.string.nav_trips, TripsActivity::class.java),
        FUEL("FUEL", R.string.nav_fuel, FuelActivity::class.java),
        PERF("PERFORMANCE", R.string.nav_perf, PerformanceActivity::class.java),
        MAINT("MAINTENANCE", R.string.nav_maint, MaintenanceActivity::class.java)
    }

    fun setup(activity: Activity, current: Page) {
        if (android.os.Build.VERSION.SDK_INT >= 35 && activity.applicationInfo.targetSdkVersion >= 35) {
            activity.findViewById<android.view.View>(android.R.id.content).apply {
                setOnApplyWindowInsetsListener { view, insets ->
                    val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                    insets
                }
                requestApplyInsets()
            }
        }

        // Set current page title on compact header bar
        activity.findViewById<TextView?>(R.id.tvNavCurrentTitle)?.text = current.title

        // Setup Hamburger Menu Button
        activity.findViewById<ImageButton?>(R.id.btnNavMenu)?.let { btnNavMenu ->
            btnNavMenu.setOnClickListener { v ->
                val popup = PopupMenu(activity, v)
                Page.values().forEachIndexed { index, page ->
                    val item = popup.menu.add(0, index, index, activity.getString(page.menuStringRes))
                    if (page == current) {
                        item.setIcon(android.R.drawable.checkbox_on_background)
                    }
                }
                popup.setOnMenuItemClickListener { menuItem ->
                    val selectedPage = Page.values().getOrNull(menuItem.itemId)
                    if (selectedPage != null && selectedPage != current) {
                        activity.startActivity(Intent(activity, selectedPage.targetClass))
                    }
                    true
                }
                popup.show()
            }
        }

        // Setup toggle button for horizontal pills
        val navPillsScroll = activity.findViewById<View?>(R.id.navPillsScroll)
        val btnToggleNavPills = activity.findViewById<TextView?>(R.id.btnToggleNavPills)
        btnToggleNavPills?.setOnClickListener {
            val isVisible = navPillsScroll?.visibility == View.VISIBLE
            navPillsScroll?.visibility = if (isVisible) View.GONE else View.VISIBLE
            btnToggleNavPills.text = if (isVisible) "PAGES ▾" else "PAGES ▴"
        }

        bind(activity, current, Page.GATEWAY, R.id.navGateway, MainActivity::class.java)
        bind(activity, current, Page.DIAGNOSTICS, R.id.navDiagnostics, DiagnosticsActivity::class.java)
        bind(activity, current, Page.TRIPS, R.id.navTrips, TripsActivity::class.java)
        bind(activity, current, Page.FUEL, R.id.navFuel, FuelActivity::class.java)
        bind(activity, current, Page.PERF, R.id.navPerf, PerformanceActivity::class.java)
        bind(activity, current, Page.MAINT, R.id.navMaint, MaintenanceActivity::class.java)
    }

    private fun bind(activity: Activity, current: Page, page: Page, pillId: Int, target: Class<*>) {
        val pill = activity.findViewById<TextView>(pillId) ?: return
        val active = page == current
        pill.setBackgroundResource(if (active) R.drawable.nav_pill_active else R.drawable.nav_pill_inactive)
        pill.setTextColor(
            ContextCompat.getColor(
                activity,
                if (active) R.color.accent_cyan else R.color.text_secondary
            )
        )
        pill.setOnClickListener {
            if (!active) activity.startActivity(Intent(activity, target))
        }
    }
}
