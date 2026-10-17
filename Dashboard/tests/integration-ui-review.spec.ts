import { test, expect, Page } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

// A zone west of UTC catches date-only parsing that silently selects the previous day.
test.use({ timezoneId: 'America/Los_Angeles' });

const cars = [
  { id: 'default', name: 'Road car', tankLitres: 33 },
  { id: 'second', name: 'Second car', tankLitres: 40 },
];
const now = Date.UTC(2026, 9, 18, 14);
const emptyRankings = { best_efficiency: [], longest_distance: [], highest_speed: [], longest_duration: [] };
const summary = {
  durationMin: 12, distanceKm: 4.2, avgSpeed: 21, maxSpeed: 55, maxRpm: 2400,
  pointCount: 5, fuelEfficiencyKmL: 99, fuelUsedPercent: 2, driverScore: 90,
  estimatedFuelUsedLitres: 0.3, estimatedFuelEconomyKmL: 14,
  estimatedIdleFuelLitres: 0.01, idleSeconds: 15, distanceSource: 'obd-speed',
  startLocation: null, endLocation: null,
  quality: { fuelCoverageRatio: 0.95, economyCoverageRatio: 0.4, distanceCoverageRatio: 1,
    idleStateCoverageRatio: 1, idleFuelCoverageRatio: 1, gapCount: 0 },
};
function drive(id = 'review-trip', fields: Record<string, unknown> = {}) {
  return { id, vehicleId: 'default', label: id, startTime: now - 720000, endTime: now,
    summary: { ...summary, ...fields } };
}

async function setup(page: Page, selected: string | null = 'default', multiple = false) {
  await establishCachedBrowserSession(page);
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(value => {
    if (value === null) localStorage.removeItem('obd_active_vehicle_id');
    else localStorage.setItem('obd_active_vehicle_id', value);
  }, selected);
  await page.route('**/api/vehicles', route => route.fulfill({ json: multiple ? cars : [cars[0]] }));
}

async function readings(page: Page, timestamp: unknown = now - 1000) {
  const sample = { timestamp, vehicleId: 'default', eventId: 'review-sample', rpm: 1920, speed: 52,
    voltage: 13.9, coolantTemp: 88, latitude: 0, longitude: 0, estimatedFuelEconomyKmL: 16.4,
    estimatedFuelRateLph: 3.2 };
  await page.route('**/api/telemetry/snapshot*', route => route.fulfill({ json: { records: [sample], snapshotCursor: 1 } }));
  await page.route('**/api/telemetry/changes*', route => route.fulfill({ json: { records: [], nextCursor: 1, hasMore: false } }));
}

async function tripData(page: Page, drives: ReturnType<typeof drive>[] = [drive()]) {
  await page.route('**/api/drives*', route => route.fulfill({ json: drives }));
  await page.route('**/api/trips/leaderboard*', route => route.fulfill({ json: emptyRankings }));
  await page.route('**/api/telemetry/series*', route => route.fulfill({ json: [
    { timestamp: now - 1000, speed: 0, rpm: 900, latitude: 0, longitude: 0 },
    { timestamp: now, speed: 30, rpm: 1800, latitude: 0, longitude: 0 },
  ] }));
}

async function chooseVehicle(page: Page, name: string) {
  const native = page.locator('.vehicle-picker select');
  if (await native.count()) await native.selectOption({ label: name });
  else {
    await page.locator('.vehicle-picker-btn').click();
    await page.locator('.vehicle-menu-item').filter({ hasText: name }).click();
  }
}

test.beforeEach(() => test.skip(!e2eConfigured(), 'Disposable local backend credentials required'));

for (const timestamp of [now + 3600000, 'invalid-timestamp']) {
  test(`future or invalid sample time is not advertised as recent: ${timestamp}`, async ({ page }) => {
    await setup(page);
    await readings(page, timestamp);
    await page.goto('/');
    await expect(page.locator('.metric-summary-card').filter({ hasText: 'Engine Speed' })).toContainText('1,920');
    const status = page.getByRole('region', { name: 'Data freshness' });
    await expect(status).not.toContainText('Recent sample');
    await expect(status).toContainText(/awaiting|clock|timestamp|future|invalid|no recent/i);
    await expect(page.getByTestId('fuel-rate')).toHaveText('Estimated fuel rate: N/A');
  });
}

test('single-car default and explicitly saved All Vehicles remain distinct', async ({ page }) => {
  await setup(page, null);
  await readings(page);
  await page.goto('/');
  await expect(page.locator('.vehicle-picker')).toContainText('Road car');
  await expect.poll(() => page.evaluate(() => document.querySelector('h1')?.textContent)).toContain('Road car');
  await page.addInitScript(() => localStorage.setItem('obd_active_vehicle_id', 'all'));
  await page.reload();
  await expect(page.locator('.vehicle-picker')).toContainText('All Vehicles');
});

test('fleet readings require a vehicle and do not present a mixed engine state', async ({ page }) => {
  await setup(page, 'all', true);
  await readings(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Inspect Telemetry/i })).toHaveCount(2);
  await expect(page.getByText('Engine Speed', { exact: true })).toHaveCount(0);
  await expect(page.locator('.metric-summary-value').filter({ hasText: '1,920' })).toHaveCount(0);
  await page.getByRole('button', { name: /Inspect Telemetry/i }).first().click();
  await expect(page.locator('.metric-summary-card').filter({ hasText: 'Engine Speed' })).toContainText('1,920');
});

test('empty readings provide a direct path to first device setup', async ({ page }) => {
  await setup(page);
  await page.route('**/api/telemetry/snapshot*', route => route.fulfill({ json: { records: [], snapshotCursor: 0 } }));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Pair head unit', exact: true })).toHaveAttribute('href', '/pair');
});

test('Overview preserves missing estimates and distance instead of showing legacy values or healthy defaults', async ({ page }) => {
  await setup(page);
  await tripData(page, [drive('missing', { distanceKm: null, estimatedFuelEconomyKmL: null })]);
  await page.route('**/api/telemetry/latest*', route => route.fulfill({ json: null }));
  await page.route('**/api/maintenance/status*', route => route.fulfill({ json: { okCount: 0, dueSoonCount: 0, overdueCount: 0 } }));
  await page.goto('/overview');
  const economy = page.locator('.metric-summary-card').filter({ hasText: 'Last trip economy' });
  const distance = page.locator('.metric-summary-card').filter({ hasText: 'Recorded distance today' });
  await expect(economy).toContainText('N/A');
  await expect(economy).not.toContainText('99');
  await expect(distance).toContainText('N/A');
  await expect(page.getByText('Nominal', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No active faults or overdue tasks', { exact: true })).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).not.toContainText('99');
});

test('Overview labels genuine legacy tank estimates as unvalidated', async ({ page }) => {
  await setup(page);
  const legacy = drive('legacy');
  delete (legacy.summary as Partial<typeof summary>).estimatedFuelEconomyKmL;
  await tripData(page, [legacy]);
  await page.route('**/api/telemetry/latest*', route => route.fulfill({ json: null }));
  await page.route('**/api/maintenance/status*', route => route.fulfill({ json: { okCount: 0, dueSoonCount: 0, overdueCount: 0 } }));
  await page.goto('/overview');
  const economy = page.locator('.metric-summary-card').filter({ hasText: 'Last trip economy' });
  await expect(economy).toContainText('99.0');
  await expect(economy).toContainText(/legacy.*tank|tank.*legacy/i);
  await expect(economy).toContainText(/unvalidated/i);
});

test('Overview reports primary API failure and does not fabricate zero recorded distance', async ({ page }) => {
  await setup(page);
  await page.route('**/api/drives*', route => route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } }));
  await page.route('**/api/telemetry/latest*', route => route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } }));
  await page.route('**/api/maintenance/status*', route => route.fulfill({ json: { okCount: 0, dueSoonCount: 0, overdueCount: 0 } }));
  await page.goto('/overview');
  await expect(page.getByRole('region', { name: 'Data freshness' })).toContainText('Cannot reach server');
  const distance = page.locator('.metric-summary-card').filter({ hasText: 'Recorded distance today' });
  await expect(distance).toContainText(/N\/A|Unavailable|—/);
});

test('fleet Overview does not attribute a single car snapshot to the fleet', async ({ page }) => {
  await setup(page, 'all', true);
  await tripData(page);
  await page.route('**/api/telemetry/latest*', route => route.fulfill({ json: { timestamp: now, rpm: 5432, speed: 91 } }));
  await page.route('**/api/maintenance/status*', route => route.fulfill({ json: { okCount: 0, dueSoonCount: 0, overdueCount: 0 } }));
  await page.goto('/overview');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/fleet/i);
  await expect(page.getByRole('region', { name: 'Latest recorded readings' })).toHaveCount(0);
  await expect(page.getByText(/5,432/)).toHaveCount(0);
});

test('Trip best estimate follows server eligibility for matched economy coverage', async ({ page }) => {
  await setup(page);
  await tripData(page, [drive('partial-economy', { estimatedFuelEconomyKmL: 40 })]);
  await page.goto('/trips');
  const best = page.locator('.metric-summary-card').filter({ hasText: 'Best Estimated Trip Economy' });
  await expect(best).toContainText('N/A');
});

test('Trip longest distance preserves a valid zero', async ({ page }) => {
  await setup(page);
  await tripData(page, [drive('zero', { distanceKm: 0 })]);
  await page.goto('/trips');
  const longest = page.locator('.metric-summary-card').filter({ hasText: 'Longest Trip' });
  await expect(longest).toContainText('0.00 km');
});

test('Trip date filters select whole days and reset pagination', async ({ page }) => {
  await setup(page);
  const fixtures = Array.from({ length: 12 }, (_, i) => ({ ...drive(`today-${i}`), startTime: now - i * 60000 }));
  fixtures.push({ ...drive('yesterday'), startTime: now - 86400000, endTime: now - 86000000 });
  await tripData(page, fixtures);
  await page.goto('/trips');
  await page.getByRole('button', { name: 'Next Page' }).click();
  await expect(page.locator('tbody')).toContainText('yesterday');
  const dates = page.locator('input[type="date"]');
  await expect(dates).toHaveCount(2);
  await dates.nth(0).fill('2026-10-18');
  await dates.nth(1).fill('2026-10-18');
  await expect(page.locator('tbody')).not.toContainText('yesterday');
  await expect(page.locator('tbody')).toContainText('today-0');
  await expect(page.getByRole('button', { name: 'Previous Page' })).toBeDisabled();
});

test('Trip dialog traps focus, keeps focus through detail loading, and restores its trigger', async ({ page }) => {
  await setup(page);
  await tripData(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/telemetry/series*', async route => {
    await ready;
    await route.fulfill({ json: [{ timestamp: now, speed: 0, rpm: 900, latitude: 0, longitude: 0 }] });
  });
  await page.goto('/trips');
  const trigger = page.getByRole('button', { name: /View details for drive/i }).first();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  const routeTab = dialog.getByRole('button', { name: 'Route Map', exact: true })
    .or(dialog.getByRole('tab', { name: 'Route Map', exact: true }));
  await routeTab.click();
  const response = page.waitForResponse(r => r.url().includes('/api/telemetry/series'));
  release();
  await response;
  await expect(dialog.getByText('Loading trip route...', { exact: true })).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(routeTab).toBeFocused();
  const close = dialog.getByRole('button', { name: /Close.*(trip details|dialog)/i }).first();
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('changing trip vehicle clears the old scope while the new response is pending', async ({ page }) => {
  await setup(page, 'default', true);
  await tripData(page, [drive('road-only')]);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/drives*', async route => {
    const vehicle = new URL(route.request().url()).searchParams.get('vehicle');
    if (vehicle === 'second') {
      await ready;
      await route.fulfill({ json: [{ ...drive('second-only'), vehicleId: 'second' }] });
    } else await route.fulfill({ json: [drive('road-only')] });
  });
  await page.goto('/trips');
  await expect(page.locator('tbody')).toContainText('road-only');
  await chooseVehicle(page, 'Second car');
  await expect(page.locator('tbody tr').filter({ hasText: 'road-only' })).toHaveCount(0);
  release();
  await expect(page.locator('tbody')).toContainText('second-only');
});

test('diagnostic commands cannot target an implicit default vehicle from All Vehicles', async ({ page }) => {
  await setup(page, 'all', true);
  await page.route('**/api/telemetry/dtc*', route => route.fulfill({ json: {
    latest: { latestDtc: { code: '', timestamp: null }, latestReadStatus: { success: null, timestamp: null }, latestClearStatus: { success: null, timestamp: null } }, history: [],
  } }));
  await page.route('**/api/commands/status*', route => route.fulfill({ json: { commands: [] } }));
  await page.goto('/diagnostics');
  await expect(page.getByRole('button', { name: /clear fault codes/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /read fault codes/i })).toBeDisabled();
});

test('refuel validation retains the selected vehicle odometer boundary', async ({ page }) => {
  await setup(page);
  const writes: unknown[] = [];
  await page.route('**/api/fuel-logs*', async route => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { success: true } });
    } else await route.fulfill({ json: [
      { id: 'previous', timestamp: now - 1000, vehicleId: 'default', litres: 20, odometer: 1000, fillState: 'unknown' },
    ] });
  });
  await page.route('**/api/fuel-stats*', route => route.fulfill({ json: {
    averageKmPerLitre: null, bestKmPerLitre: null, worstKmPerLitre: null, totalLitres: 20,
    totalDistance: 0, logCount: 1, cycleCount: 0, unknownFillCount: 1,
  } }));
  await page.goto('/fuel');
  await expect(page.locator('tbody')).toContainText('1000.0');
  await page.locator('#fuel-litres-input').fill('10');
  await page.locator('#fuel-odo-input').fill('900');
  await page.getByRole('button', { name: 'Add Refuel Entry' }).click();
  await expect(page.locator('.form-error')).toContainText(/higher|previous|odometer/i);
  expect(writes).toEqual([]);
});

test('keyboard vehicle selection and mobile Escape return focus to their controls', async ({ page }) => {
  await setup(page, 'default', true);
  await readings(page);
  await page.goto('/');
  const picker = page.locator('.vehicle-picker-btn');
  await picker.focus();
  await page.keyboard.press('Enter');
  const item = page.locator('.vehicle-menu-item').filter({ hasText: 'Second car' });
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(picker).toContainText('Second car');
  await expect(picker).toBeFocused();
  await page.setViewportSize({ width: 390, height: 800 });
  const menu = page.getByRole('button', { name: 'Open navigation menu', exact: true });
  await menu.click();
  await page.locator('.mobile-nav-drawer').getByRole('link', { name: 'Trips', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mobile-nav-drawer')).toHaveCount(0);
  await expect(page.locator('.mobile-menu-btn')).toBeFocused();
});

test('vehicle management and forms fit a 320px screen', async ({ page }) => {
  await setup(page);
  for (const path of ['/account', '/garage', '/pair', '/maintenance', '/fuel']) {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.locator('input, select, textarea').evaluateAll(elements => elements
      .filter(el => el.getClientRects().length > 0)
      .map(el => ({ label: el.getAttribute('id'), rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left < 0 || rect.right > window.innerWidth + 1)
      .map(({ label }) => label));
    expect(overflow, `off-screen controls on ${path}`).toEqual([]);
  }
});

test('vehicle create and edit forms reject out-of-range tank capacities', async ({ page }) => {
  await setup(page);
  await page.goto('/garage');
  for (const name of ['Add Vehicle', 'Edit Road car']) {
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog');
    const tank = dialog.getByRole('spinbutton');
    for (const value of ['0', '500.1']) {
      await tank.fill(value);
      expect(await tank.evaluate(el => (el as HTMLInputElement).checkValidity())).toBe(false);
    }
    for (const value of ['1', '500']) {
      await tank.fill(value);
      expect(await tank.evaluate(el => (el as HTMLInputElement).checkValidity())).toBe(true);
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});

test('performance retains personal-best context and handles missing sprint times', async ({ page }) => {
  await setup(page);
  await page.route('**/api/performance/records*', route => route.fulfill({ json: {
    best0to100: { time: 9.5, timestamp: now, driveId: 'best-trip' },
    topSpeed: null, highestRpm: null, longestDrive: null, totalDrivingTime: 12, totalDrives: 2,
  } }));
  await page.route('**/api/performance/runs*', route => route.fulfill({ json: [
    { id: 'best-run', timestamp: now, accelTime: 9.5, driveId: 'best-trip', maxSpeedReached: 101 },
    { id: 'old-run', timestamp: now - 3600000, accelTime: null, driveId: 'old-trip', maxSpeedReached: null },
  ] }));
  await page.goto('/performance');
  const history = page.getByRole('region', { name: 'Acceleration runs history' });
  await expect(history.getByRole('row').filter({ hasText: '#best-trip' })).toContainText('9.50s');
  await expect(history.getByRole('row').filter({ hasText: '#best-trip' })).toContainText('Personal best');
  await expect(history.getByRole('row').filter({ hasText: '#old-trip' })).toContainText('N/A');
});

test('workspace font and responsive layout render without hiding off-screen controls', async ({ page }, testInfo) => {
  await setup(page);
  await readings(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.metric-summary-card').filter({ hasText: 'Engine Speed' })).toContainText('1,920');
  const font = await page.locator('main').evaluate(el => getComputedStyle(el).fontFamily);
  expect(font).not.toContain('Times New Roman');
  expect(font).toMatch(/Outfit|sans-serif|system-ui/);
  const grid = page.locator('.telemetry-primary-grid');
  await expect(grid).toHaveCSS('display', 'grid');
  const metricRows = () => grid.locator(':scope > *').evaluateAll(cards =>
    cards.map(card => Math.round(card.getBoundingClientRect().top)));
  expect(new Set(await metricRows()).size).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('readings-desktop.png'), fullPage: true });
  await page.locator('.recharts-wrapper').first().hover({ position: { x: 120, y: 50 } });
  await expect(page.locator('.recharts-tooltip-wrapper').first()).toBeVisible();
  await expect(page.locator('.recharts-tooltip-wrapper').first()).toContainText('52');
  await page.getByRole('heading', { level: 1 }).hover();
  for (const width of [320, 350, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const rows = await metricRows();
    // Six metrics occupy three rows on phones and two rows on tablets.
    expect(new Set(rows).size).toBe(width <= 600 ? 3 : 2);
    expect(rows[0]).toBe(rows[1]);
    const overflow = await page.locator('main *').evaluateAll(elements => elements
      .filter(el => el.getClientRects().length > 0 && el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 10).map(el => ({ tag: el.tagName, className: el.getAttribute('class'), right: el.getBoundingClientRect().right })));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
      message: `Horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`,
    }).toBe(true);
    const picker = page.locator('.vehicle-picker');
    const rect = await picker.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('readings-mobile.png'), fullPage: true });
});
