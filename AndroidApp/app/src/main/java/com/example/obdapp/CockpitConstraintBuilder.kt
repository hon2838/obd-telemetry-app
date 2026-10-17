package com.example.obdapp

import android.view.View
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.constraintlayout.widget.ConstraintSet

/**
 * Programmatic ConstraintSet topology engine for the automotive cockpit.
 * Eliminates layout duplication and dynamically reconfigures the flat 12-slot
 * ConstraintLayout based on the active ScreenClass:
 * - COMPACT_LAND (6 slots): 2 rows x 3 columns (zero dual-stacking)
 * - ULTRAWIDE_LAND (8 slots): 1:1 Left/Right Hero Dials spanning 2 rows + 2x3 center matrix
 * - PORTRAIT_COCKPIT (10 slots): 4 rows (2 hero + 2 wide + 3 cards + 3 cards)
 * - EXPANSIVE_LAND (12 slots): 3 rows x 4 columns full cluster
 */
object CockpitConstraintBuilder {

    private val ALL_SLOT_IDS = intArrayOf(
        R.id.widgetSlot0, R.id.widgetSlot1, R.id.widgetSlot2, R.id.widgetSlot3,
        R.id.widgetSlot4, R.id.widgetSlot5, R.id.widgetSlot6, R.id.widgetSlot7,
        R.id.widgetSlot8, R.id.widgetSlot9, R.id.widgetSlot10, R.id.widgetSlot11
    )

    fun applyLayout(layout: ConstraintLayout, screenClass: ScreenClass) {
        val cs = ConstraintSet()
        cs.clone(layout)

        val marginPx = (2 * layout.resources.displayMetrics.density).toInt()

        // 1. Reset all 12 slots to MATCH_CONSTRAINT (0dp) width & height with 2dp margins preserved
        for (id in ALL_SLOT_IDS) {
            cs.clear(id)
            cs.constrainWidth(id, ConstraintSet.MATCH_CONSTRAINT)
            cs.constrainHeight(id, ConstraintSet.MATCH_CONSTRAINT)
            cs.setMargin(id, ConstraintSet.LEFT, marginPx)
            cs.setMargin(id, ConstraintSet.RIGHT, marginPx)
            cs.setMargin(id, ConstraintSet.START, marginPx)
            cs.setMargin(id, ConstraintSet.END, marginPx)
            cs.setMargin(id, ConstraintSet.TOP, marginPx)
            cs.setMargin(id, ConstraintSet.BOTTOM, marginPx)
            cs.setVisibility(id, View.GONE)
        }

        // 2. Set visibility for active slots per ScreenClass
        val activeCount = screenClass.visibleSlotCount.coerceIn(1, ALL_SLOT_IDS.size)
        for (i in 0 until activeCount) {
            cs.setVisibility(ALL_SLOT_IDS[i], View.VISIBLE)
        }

        // 3. Build specific topology
        when (screenClass) {
            ScreenClass.COMPACT_LAND -> buildCompactLand(cs)
            ScreenClass.ULTRAWIDE_LAND -> buildUltraWideLand(cs)
            ScreenClass.PORTRAIT_COCKPIT -> buildPortraitCockpit(cs)
            ScreenClass.EXPANSIVE_LAND -> buildExpansiveLand(cs)
        }

        cs.applyTo(layout)
    }

    /**
     * COMPACT_LAND (1024x600 / 800x480): 6 slots
     * Row 1 (60% H): Slot 0 (Hero Dial 1), Slot 2 (Center Primary), Slot 1 (Hero Dial 2)
     * Row 2 (40% H): Slot 3 (Bar), Slot 4 (Bar/Spark), Slot 5 (Digital)
     */
    private fun buildCompactLand(cs: ConstraintSet) {
        val row1 = intArrayOf(R.id.widgetSlot0, R.id.widgetSlot2, R.id.widgetSlot1)
        val row2 = intArrayOf(R.id.widgetSlot3, R.id.widgetSlot4, R.id.widgetSlot5)

        // Row 1 Horizontal Chain
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT,
            ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row1,
            floatArrayOf(1.05f, 0.9f, 1.05f),
            ConstraintSet.CHAIN_SPREAD
        )

        // Row 2 Horizontal Chain
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT,
            ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row2,
            floatArrayOf(1f, 1f, 1f),
            ConstraintSet.CHAIN_SPREAD
        )

        // Vertical Chaining: Column 0 forms reciprocal vertical chain with weights
        cs.createVerticalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.TOP,
            ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM,
            intArrayOf(row1[0], row2[0]),
            floatArrayOf(1.25f, 0.75f),
            ConstraintSet.CHAIN_SPREAD
        )

        // Align sibling views in each row to Column 0 (with margin = 0 to prevent double vertical insetting)
        for (i in 1 until row1.size) {
            cs.connect(row1[i], ConstraintSet.TOP, row1[0], ConstraintSet.TOP, 0)
            cs.connect(row1[i], ConstraintSet.BOTTOM, row1[0], ConstraintSet.BOTTOM, 0)
        }
        for (i in 1 until row2.size) {
            cs.connect(row2[i], ConstraintSet.TOP, row2[0], ConstraintSet.TOP, 0)
            cs.connect(row2[i], ConstraintSet.BOTTOM, row2[0], ConstraintSet.BOTTOM, 0)
        }
    }

    /**
     * ULTRAWIDE_LAND (1920x720, 1600x600, 24:9): 8 slots
     * Left: Slot 0 (Hero Dial 1, 26% width, spans full height)
     * Right: Slot 1 (Hero Dial 2, 26% width, spans full height)
     * Center: 48% width, 2 rows of 3 columns
     *   Center Row 1: Slots 2, 3, 4
     *   Center Row 2: Slots 5, 6, 7
     */
    private fun buildUltraWideLand(cs: ConstraintSet) {
        val leftDial = R.id.widgetSlot0
        val rightDial = R.id.widgetSlot1
        val centerRow1 = intArrayOf(R.id.widgetSlot2, R.id.widgetSlot3, R.id.widgetSlot4)
        val centerRow2 = intArrayOf(R.id.widgetSlot5, R.id.widgetSlot6, R.id.widgetSlot7)

        // Left Hero Dial (1:1 Aspect Hero spanning full height, 26% width)
        cs.connect(leftDial, ConstraintSet.LEFT, ConstraintSet.PARENT_ID, ConstraintSet.LEFT)
        cs.connect(leftDial, ConstraintSet.TOP, ConstraintSet.PARENT_ID, ConstraintSet.TOP)
        cs.connect(leftDial, ConstraintSet.BOTTOM, ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM)
        cs.constrainPercentWidth(leftDial, 0.26f)

        // Right Hero Dial (1:1 Aspect Hero spanning full height, 26% width)
        cs.connect(rightDial, ConstraintSet.RIGHT, ConstraintSet.PARENT_ID, ConstraintSet.RIGHT)
        cs.connect(rightDial, ConstraintSet.TOP, ConstraintSet.PARENT_ID, ConstraintSet.TOP)
        cs.connect(rightDial, ConstraintSet.BOTTOM, ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM)
        cs.constrainPercentWidth(rightDial, 0.26f)

        // Center Row 1 Horizontal Chain (between leftDial and rightDial)
        cs.createHorizontalChain(
            leftDial, ConstraintSet.RIGHT,
            rightDial, ConstraintSet.LEFT,
            centerRow1,
            floatArrayOf(1f, 1f, 1f),
            ConstraintSet.CHAIN_SPREAD
        )

        // Center Row 2 Horizontal Chain (between leftDial and rightDial)
        cs.createHorizontalChain(
            leftDial, ConstraintSet.RIGHT,
            rightDial, ConstraintSet.LEFT,
            centerRow2,
            floatArrayOf(1f, 1f, 1f),
            ConstraintSet.CHAIN_SPREAD
        )

        // Center Vertical Chaining: Column 0 forms reciprocal vertical chain with weights
        cs.createVerticalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.TOP,
            ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM,
            intArrayOf(centerRow1[0], centerRow2[0]),
            floatArrayOf(1f, 1f),
            ConstraintSet.CHAIN_SPREAD
        )

        // Align sibling views in each center row to Column 0 (with margin = 0 to prevent double vertical insetting)
        for (i in 1 until centerRow1.size) {
            cs.connect(centerRow1[i], ConstraintSet.TOP, centerRow1[0], ConstraintSet.TOP, 0)
            cs.connect(centerRow1[i], ConstraintSet.BOTTOM, centerRow1[0], ConstraintSet.BOTTOM, 0)
        }
        for (i in 1 until centerRow2.size) {
            cs.connect(centerRow2[i], ConstraintSet.TOP, centerRow2[0], ConstraintSet.TOP, 0)
            cs.connect(centerRow2[i], ConstraintSet.BOTTOM, centerRow2[0], ConstraintSet.BOTTOM, 0)
        }
    }

    /**
     * PORTRAIT_COCKPIT (1080x1920, 1200x2000): 10 slots
     * Row 1: Slots 0, 1 (2 large hero dials)
     * Row 2: Slots 2, 3 (2 wide cards / waveforms)
     * Row 3: Slots 4, 5, 6 (3 cards)
     * Row 4: Slots 7, 8, 9 (3 cards)
     */
    private fun buildPortraitCockpit(cs: ConstraintSet) {
        val row1 = intArrayOf(R.id.widgetSlot0, R.id.widgetSlot1)
        val row2 = intArrayOf(R.id.widgetSlot2, R.id.widgetSlot3)
        val row3 = intArrayOf(R.id.widgetSlot4, R.id.widgetSlot5, R.id.widgetSlot6)
        val row4 = intArrayOf(R.id.widgetSlot7, R.id.widgetSlot8, R.id.widgetSlot9)

        // Horizontal Chains
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT, ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row1, floatArrayOf(1f, 1f), ConstraintSet.CHAIN_SPREAD
        )
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT, ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row2, floatArrayOf(1f, 1f), ConstraintSet.CHAIN_SPREAD
        )
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT, ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row3, floatArrayOf(1f, 1f, 1f), ConstraintSet.CHAIN_SPREAD
        )
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT, ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row4, floatArrayOf(1f, 1f, 1f), ConstraintSet.CHAIN_SPREAD
        )

        // Vertical Chaining: Column 0 forms reciprocal vertical chain across all 4 rows
        cs.createVerticalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.TOP,
            ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM,
            intArrayOf(row1[0], row2[0], row3[0], row4[0]),
            floatArrayOf(1.25f, 1.0f, 0.9f, 0.9f),
            ConstraintSet.CHAIN_SPREAD
        )

        // Align sibling views in each row to Column 0 (with margin = 0 to prevent double vertical insetting)
        for (i in 1 until row1.size) {
            cs.connect(row1[i], ConstraintSet.TOP, row1[0], ConstraintSet.TOP, 0)
            cs.connect(row1[i], ConstraintSet.BOTTOM, row1[0], ConstraintSet.BOTTOM, 0)
        }
        for (i in 1 until row2.size) {
            cs.connect(row2[i], ConstraintSet.TOP, row2[0], ConstraintSet.TOP, 0)
            cs.connect(row2[i], ConstraintSet.BOTTOM, row2[0], ConstraintSet.BOTTOM, 0)
        }
        for (i in 1 until row3.size) {
            cs.connect(row3[i], ConstraintSet.TOP, row3[0], ConstraintSet.TOP, 0)
            cs.connect(row3[i], ConstraintSet.BOTTOM, row3[0], ConstraintSet.BOTTOM, 0)
        }
        for (i in 1 until row4.size) {
            cs.connect(row4[i], ConstraintSet.TOP, row4[0], ConstraintSet.TOP, 0)
            cs.connect(row4[i], ConstraintSet.BOTTOM, row4[0], ConstraintSet.BOTTOM, 0)
        }
    }

    /**
     * EXPANSIVE_LAND (1920x1080, 2000x1200): 12 slots
     * Row 1: Slots 0, 6, 7, 1 (Hero Left, Center 1, Center 2, Hero Right)
     * Row 2: Slots 2, 3, 4, 5 (4 equal columns)
     * Row 3: Slots 8, 9, 10, 11 (4 equal columns)
     */
    private fun buildExpansiveLand(cs: ConstraintSet) {
        val row1 = intArrayOf(R.id.widgetSlot0, R.id.widgetSlot6, R.id.widgetSlot7, R.id.widgetSlot1)
        val row2 = intArrayOf(R.id.widgetSlot2, R.id.widgetSlot3, R.id.widgetSlot4, R.id.widgetSlot5)
        val row3 = intArrayOf(R.id.widgetSlot8, R.id.widgetSlot9, R.id.widgetSlot10, R.id.widgetSlot11)

        // Horizontal Chains
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT, ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row1, floatArrayOf(1.05f, 0.95f, 0.95f, 1.05f), ConstraintSet.CHAIN_SPREAD
        )
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT, ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row2, floatArrayOf(1f, 1f, 1f, 1f), ConstraintSet.CHAIN_SPREAD
        )
        cs.createHorizontalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.LEFT, ConstraintSet.PARENT_ID, ConstraintSet.RIGHT,
            row3, floatArrayOf(1f, 1f, 1f, 1f), ConstraintSet.CHAIN_SPREAD
        )

        // Vertical Chaining: Column 0 forms reciprocal vertical chain across all 3 rows
        cs.createVerticalChain(
            ConstraintSet.PARENT_ID, ConstraintSet.TOP,
            ConstraintSet.PARENT_ID, ConstraintSet.BOTTOM,
            intArrayOf(row1[0], row2[0], row3[0]),
            floatArrayOf(1.2f, 0.9f, 0.9f),
            ConstraintSet.CHAIN_SPREAD
        )

        // Align sibling views in each row to Column 0 (with margin = 0 to prevent double vertical insetting)
        for (i in 1 until row1.size) {
            cs.connect(row1[i], ConstraintSet.TOP, row1[0], ConstraintSet.TOP, 0)
            cs.connect(row1[i], ConstraintSet.BOTTOM, row1[0], ConstraintSet.BOTTOM, 0)
        }
        for (i in 1 until row2.size) {
            cs.connect(row2[i], ConstraintSet.TOP, row2[0], ConstraintSet.TOP, 0)
            cs.connect(row2[i], ConstraintSet.BOTTOM, row2[0], ConstraintSet.BOTTOM, 0)
        }
        for (i in 1 until row3.size) {
            cs.connect(row3[i], ConstraintSet.TOP, row3[0], ConstraintSet.TOP, 0)
            cs.connect(row3[i], ConstraintSet.BOTTOM, row3[0], ConstraintSet.BOTTOM, 0)
        }
    }
}
