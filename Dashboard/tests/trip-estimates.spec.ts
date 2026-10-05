import { test, expect } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

const startTime = 1700000000000;
const baseSummary = {
  durationMin: 2, maxRpm: 2000, maxSpeed: 60, fuelUsedPercent: 2, pointCount: 10,
  distanceKm: 1.5, avgSpeed: 60, startLocation: null, endLocation: null,
  fuelEfficiencyKmL: 99, driverScore: 100,
  distanceSource: 'obd-speed', estimatedFuelUsedLitres: 0.15,
  estimatedFuelEconomyKmL: 10, estimatedIdleFuelLitres: 0.01, idleSeconds: 10,
  quality: { coverageRatio: 1, fuelCoverageRatio: 0.75, economyCoverageRatio: 0.5,
    distanceCoverageRatio: 1, idleStateCoverageRatio: 1, idleFuelCoverageRatio: 1,
    gapCount: 0, maxIntervalSeconds: 30, efficiencyLeaderboardEligible: false }
};

test.beforeEach(async ({ page }) => {
  test.skip(!e2eConfigured(), 'E2E_PASSWORD is not set for the disposable backend account');
  await establishCachedBrowserSession(page);
});

for (const scenario of ['covered', 'missing', 'zero', 'legacy'] as const) {
  test(`trip estimates display ${scenario} data honestly`, async ({ page }) => {
    const summary: Record<string, any> = { ...baseSummary };
    if (scenario === 'missing') Object.assign(summary, {
      distanceKm: null, avgSpeed: null, distanceSource: 'unavailable',
      estimatedFuelUsedLitres: null, estimatedFuelEconomyKmL: null,
      estimatedIdleFuelLitres: null, idleSeconds: null,
    });
    if (scenario === 'zero') Object.assign(summary, {
      estimatedFuelUsedLitres: 0, estimatedFuelEconomyKmL: 0,
      estimatedIdleFuelLitres: 0, idleSeconds: 0,
    });
    if (scenario === 'legacy') {
      delete summary.estimatedFuelUsedLitres;
      delete summary.estimatedFuelEconomyKmL;
      delete summary.quality;
    }
    const drive = { id: `estimate-${scenario}`, vehicleId: 'default', startTime,
      endTime: startTime + 120000, label: 'Trip estimate test', summary };
    await page.route('**/api/drives*', route => route.fulfill({ json: [drive] }));
    await page.route('**/api/trips/leaderboard*', route => route.fulfill({ json: {
      best_efficiency: [], longest_distance: [], highest_speed: [], longest_duration: []
    } }));
    const detailRecords = [
      { timestamp: startTime, speed: null, gpsSpeed: 0, rpm: null, latitude: 0, longitude: 0 },
      { timestamp: startTime + 1000, speed: null, gpsSpeed: 0, rpm: null, latitude: 0, longitude: 0 }
    ] as { timestamp: number; speed: number | null; gpsSpeed: number; rpm: number | null; latitude: number; longitude: number }[];
    await page.route('**/api/telemetry/series*', route => route.fulfill({ json: detailRecords }));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/trips');
    const row = page.locator('tbody tr').filter({ hasText: `Drive #${drive.id}` });
    await expect(row).toBeVisible();
    if (scenario === 'covered') {
      await expect(row).toContainText('0.150 L');
      await expect(row).toContainText('10.00 km/L');
      await expect(row).toContainText('Fuel 75%');
      await expect(row).toContainText('Economy 50%');
      await expect(row).toContainText('OBD speed estimate');
      await expect(row).not.toContainText('99.00 km/L');
    } else if (scenario === 'missing') {
      await expect(row).toContainText('N/A');
      await expect(row).not.toContainText('99.00 km/L');
      await expect(page.locator('.glass-panel-static').filter({ hasText: 'Total Distance' })).toContainText('N/A');
    } else if (scenario === 'zero') {
      await expect(row).toContainText('0.000 L');
      await expect(row).toContainText('0.00 km/L');
    } else {
      await expect(row).toContainText('99.00 km/L');
      await expect(row).toContainText('Legacy tank-level estimate');
    }
    await row.click();
    const modal = page.locator('.modal-overlay');
    await expect(modal).toContainText('Recorded Idling');
    await expect(modal).toContainText('same recorded periods');
    await expect(modal).toContainText('Missing data stays unavailable');
    await expect(modal.locator('.recharts-line')).toHaveCount(2);
    // Recharts retains the SVG path elements for all-null series, but leaves
    // their drawing data empty. A DOM count cannot distinguish absent values
    // from a fabricated zero-speed/RPM curve.
    const curves = modal.locator('.recharts-line-curve');
    await expect(curves).toHaveCount(2);
    await expect.poll(() => curves.evaluateAll(paths => paths.map(path => path.getAttribute('d') || ''))).toEqual(['', '']);
    await expect(modal).toContainText('Legacy tank estimate');
    if (scenario === 'covered') await page.screenshot({ path: 'test-results/trip-covered-estimates.png', fullPage: true });
    if (scenario === 'zero') {
      // The same chart must draw real zero samples; this ensures the null-path
      // assertion above checks missing data rather than a chart that never renders.
      for (const record of detailRecords) { record.speed = 0; record.rpm = 0; }
      await modal.locator('button').first().click();
      await row.click();
      await expect(modal.locator('.recharts-line')).toHaveCount(2);
      await expect.poll(() => modal.locator('.recharts-line-curve').evaluateAll(paths =>
        paths.filter(path => (path.getAttribute('d') || '').trim().startsWith('M')).length)).toBe(2);
    }
    expect(errors).toEqual([]);
  });
}
