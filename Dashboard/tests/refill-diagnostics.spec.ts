import { test, expect, Page } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

const vehicles = [{ id: 'refill-a', name: 'Car A' }, { id: 'refill-b', name: 'Car B' }];
async function setup(page: Page, selected = 'all') {
  await establishCachedBrowserSession(page);
  await page.addInitScript(id => localStorage.setItem('obd_active_vehicle_id', id), selected);
  await page.route('**/api/vehicles', route => route.fulfill({ json: vehicles }));
}

test.beforeEach(() => test.skip(!e2eConfigured(), 'Disposable backend E2E_PASSWORD required'));

test('manual refill history and summary use server vehicle cycles and label unknown entries', async ({ page }) => {
  await setup(page);
  await page.route('**/api/fuel-logs*', route => route.fulfill({ json: [
    { id: 'b-end', vehicleId: 'refill-b', timestamp: 5, litres: 20, odometer: 10200, fillState: 'full', economy: 10, cycleDistance: 200, cycleLitres: 20, economyStatus: 'full-cycle', source: 'web' },
    { id: 'a-end', vehicleId: 'refill-a', timestamp: 4, litres: 15, odometer: 1300, fillState: 'full', economy: 15, cycleDistance: 300, cycleLitres: 20, economyStatus: 'full-cycle', source: 'web' },
    { id: 'a-partial', vehicleId: 'refill-a', timestamp: 3, litres: 5, odometer: 1100, fillState: 'partial', economy: null, economyStatus: 'partial-fill', source: 'web' },
    { id: 'a-legacy', vehicleId: 'refill-a', timestamp: 1, litres: 20, odometer: 700, fillState: 'unknown', economy: null, economyStatus: 'unknown-fill', source: 'app' },
  ] }));
  await page.route('**/api/fuel-stats*', route => route.fulfill({ json: {
    averageKmPerLitre: 12.5, bestKmPerLitre: 15, worstKmPerLitre: 10,
    totalLitres: 60, totalDistance: 800, logCount: 4, cycleCount: 2, unknownFillCount: 1,
  } }));
  await page.goto('/fuel');
  const rows = page.locator('tbody tr');
  await expect(rows.filter({ hasText: 'Car A' }).filter({ hasText: 'Unknown' })).toContainText('Unknown fill — ineligible');
  await expect(rows.filter({ hasText: 'Car A' }).filter({ hasText: 'Partial fill' })).toContainText('Awaiting full fill');
  await expect(rows.filter({ hasText: 'Car A' }).filter({ hasText: 'Full tank' })).toContainText('15.00 km/L');
  await expect(rows.filter({ hasText: 'Car A' }).filter({ hasText: 'Full tank' })).toContainText('300 km / 20 L in cycle');
  await expect(page.getByText('2 full-tank cycles', { exact: false })).toBeVisible();
  await expect(page.getByText('Sum of each vehicle’s recorded odometer span')).toBeVisible();
  await expect(page.getByText('Current Odo:', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Refuel Entry' })).toBeDisabled();
});

test('manual refill defaults to unknown and saves explicit full state to selected vehicle', async ({ page }) => {
  await setup(page, 'refill-a');
  const saved: Record<string, unknown>[] = [];
  await page.route('**/api/fuel-logs*', async route => {
    if (route.request().method() === 'POST') {
      saved.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { success: true } });
    } else await route.fulfill({ json: [] });
  });
  await page.route('**/api/fuel-stats*', route => route.fulfill({ json: {
    averageKmPerLitre: 0, bestKmPerLitre: 0, worstKmPerLitre: 0,
    totalLitres: 0, totalDistance: 0, logCount: 0, cycleCount: 0,
  } }));
  await page.goto('/fuel');
  await expect(page.locator('#fuel-fill-state')).toHaveValue('unknown');
  await expect(page.getByText('Need two confirmed full fills for one vehicle')).toBeVisible();
  await page.locator('#fuel-litres-input').fill('20');
  await page.locator('#fuel-odo-input').fill('1000');
  await page.getByRole('button', { name: 'Add Refuel Entry' }).click();
  await expect(page.getByText('Refuel logged successfully!')).toBeVisible();
  expect(saved[0]).toMatchObject({ vehicleId: 'refill-a', litres: 20, odometer: 1000, fillState: 'unknown' });
  await page.locator('#fuel-litres-input').fill('15');
  await page.locator('#fuel-odo-input').fill('1300');
  await page.locator('#fuel-fill-state').selectOption('full');
  await page.getByRole('button', { name: 'Add Refuel Entry' }).click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[1]).toMatchObject({ vehicleId: 'refill-a', fillState: 'full' });
  await expect(page.locator('#fuel-fill-state')).toHaveValue('unknown');
});

for (const sample of [
  { name: 'failed scan with previous hexadecimal codes', code: 'p0a1f, U3ABC', success: false, heading: 'Previous confirmed fault codes (historical).' },
  { name: 'failed scan after previous empty read', code: 'No trouble codes found', success: false, heading: 'Fault status unknown' },
  { name: 'confirmed empty read', code: 'No trouble codes found', success: true, heading: 'No Fault Codes Detected' },
  { name: 'never scanned', code: '', success: null, heading: 'Fault status unknown' },
]) {
  test(`diagnostics shows ${sample.name}`, async ({ page }) => {
    await setup(page, 'refill-a');
    await page.route('**/api/commands/status*', route => route.fulfill({ json: { commands: [] } }));
    await page.route('**/api/telemetry/dtc*', route => route.fulfill({ json: {
      latest: {
        latestDtc: { code: sample.code, timestamp: sample.success === null ? null : 100 },
        latestReadStatus: { success: sample.success, timestamp: sample.success === null ? null : 200, ...(sample.success === false ? { error: 'Adapter disconnected' } : {}) },
        latestClearStatus: { success: null, timestamp: null },
      },
      history: sample.success === null ? [] : [{ id: 'read-1', timestamp: 200, type: 'read', codes: [], success: sample.success, ...(sample.success === false ? { error: 'Adapter disconnected' } : {}) }],
    } }));
    const requestedCodes: string[][] = [];
    await page.route('**/api/dtc/lookup', route => {
      const codes = route.request().postDataJSON().codes;
      requestedCodes.push(codes);
      return route.fulfill({ json: codes.map((code: string) => ({ code, description: 'Diagnostic trouble code', severity: 'moderate', system: 'Powertrain' })) });
    });
    await page.goto('/diagnostics');
    await expect(page.getByText(sample.heading, { exact: true })).toBeVisible();
    if (sample.success === false) {
      await expect(page.getByText('Latest DTC scan failed.', { exact: false })).toBeVisible();
      await expect(page.getByText('No Fault Codes Detected', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Scan failed: Adapter disconnected', { exact: true })).toBeVisible();
    }
    if (sample.code.startsWith('p0a1f')) {
      expect(requestedCodes).toContainEqual(['P0A1F', 'U3ABC']);
      await expect(page.getByText('P0A1F', { exact: true })).toBeVisible();
    }
  });
}
