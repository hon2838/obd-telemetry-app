import { test, expect } from '@playwright/test';

test.describe('OBD Dashboard Tests', () => {
  test('Trips Leaderboard renders correctly', async ({ page }) => {
    // Navigate to the trips page
    // We assume the app is running on localhost:3000 during test
    await page.goto('http://localhost:3001/trips');

    // Wait for the leaderboard container to load
    await expect(page.locator('text=Top Efficiency')).toBeVisible({ timeout: 10000 });
    
    // Check for the presence of Recharts containers
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible();
  });

  test('Navigation sidebar links work', async ({ page }) => {
    await page.goto('http://localhost:3001/');

    // Click Fuel Log
    await page.click('text=Fuel Log');
    await expect(page).toHaveURL(/.*\/fuel/);
    await expect(page.locator('text=Fuel Efficiency Trend')).toBeVisible();

    // Click Diagnostics
    await page.click('text=Diagnostics');
    await expect(page).toHaveURL(/.*\/diagnostics/);
    await expect(page.locator('text=Vehicle Diagnostics')).toBeVisible();

    // Click Maintenance
    await page.click('text=Maintenance');
    await expect(page).toHaveURL(/.*\/maintenance/);
    await expect(page.locator('text=Maintenance Tracking')).toBeVisible();
  });
});
