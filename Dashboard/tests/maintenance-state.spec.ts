import { test, expect, Page } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

const vehicles = [
  { id: 'first', name: 'First car' },
  { id: 'second', name: 'Second car' },
];

async function setup(page: Page) {
  await establishCachedBrowserSession(page);
  await page.addInitScript(() => localStorage.setItem('obd_active_vehicle_id', 'first'));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3001') return route.abort();
    return route.continue();
  });
  await page.route('**/api/vehicles', route => route.fulfill({ json: vehicles }));
}

async function selectVehicle(page: Page, name: string) {
  const native = page.locator('.vehicle-picker select');
  if (await native.count()) {
    await native.selectOption({ label: name });
  } else {
    await page.locator('.vehicle-picker-btn').click();
    await page.locator('.vehicle-menu-item').filter({ hasText: name }).click();
  }
}

function schedule(vehicleId: string, currentOdometer: number) {
  return {
    id: `${vehicleId}-oil`, vehicleId, name: 'Oil change', intervalKm: 10000,
    intervalDays: null, lastServiceOdo: 100, lastServiceDate: null, notes: '',
    currentOdometer, kmSinceService: currentOdometer - 100, daysSinceService: null,
    kmUntilDue: 10000 - (currentOdometer - 100), daysUntilDue: null, status: 'ok' as const,
  };
}

function status(okCount: number) {
  return { okCount, dueSoonCount: 0, overdueCount: 0, nextUpcoming: null };
}

test.beforeEach(() => test.skip(!e2eConfigured(), 'Disposable local backend credentials required'));

test('switching from a vehicle with mileage to an empty vehicle clears the odometer placeholder', async ({ page }) => {
  await setup(page);
  await page.route('**/api/maintenance*', route => {
    const url = new URL(route.request().url());
    const vehicleId = url.searchParams.get('vehicle');
    return route.fulfill({ json: vehicleId === 'first' ? [schedule('first', 451)] : [] });
  });
  await page.route('**/api/maintenance/status*', route => {
    const vehicleId = new URL(route.request().url()).searchParams.get('vehicle');
    return route.fulfill({ json: status(vehicleId === 'first' ? 1 : 0) });
  });
  await page.route('**/api/fuel-logs*', route => route.fulfill({ json: [] }));

  await page.goto('/maintenance');
  await expect(page.getByText('Oil change', { exact: true })).toBeVisible();
  await expect(page.locator('#maint-last-odo-input')).toHaveAttribute('placeholder', 'Default: 451');

  await selectVehicle(page, 'Second car');
  await expect(page.getByText('No maintenance schedules created')).toBeVisible();
  await expect(page.locator('#maint-last-odo-input')).toHaveAttribute('placeholder', 'Default: unavailable');
  await expect(page.getByText('Enter the last service odometer manually.')).toBeVisible();
  await expect(page.locator('.metric-summary-card').first()).toContainText('0');
});

test('a late parsed response from the old vehicle cannot replace the new vehicle state', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const originalJson = Response.prototype.json;
    Response.prototype.json = function () {
      const responseUrl = new URL(this.url);
      if (responseUrl.pathname === '/api/maintenance' && responseUrl.searchParams.get('vehicle') === 'first') {
        (window as Window & { __maintenanceOldBodyStarted?: boolean }).__maintenanceOldBodyStarted = true;
        return originalJson.call(this).then(value => new Promise(resolve => setTimeout(() => resolve(value), 700)));
      }
      return originalJson.call(this);
    };
  });
  await page.route('**/api/maintenance*', route => {
    const url = new URL(route.request().url());
    const vehicleId = url.searchParams.get('vehicle');
    return route.fulfill({ json: vehicleId === 'first' ? [schedule('first', 451)] : [] });
  });
  await page.route('**/api/maintenance/status*', route => {
    const vehicleId = new URL(route.request().url()).searchParams.get('vehicle');
    return route.fulfill({ json: status(vehicleId === 'first' ? 1 : 0) });
  });
  await page.route('**/api/fuel-logs*', route => route.fulfill({ json: [] }));

  await page.goto('/maintenance');
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __maintenanceOldBodyStarted?: boolean }).__maintenanceOldBodyStarted === true
  )).toBe(true);
  await selectVehicle(page, 'Second car');
  await expect(page.locator('#maint-last-odo-input')).toHaveAttribute('placeholder', 'Default: unavailable');
  await page.waitForTimeout(800);
  await expect(page.getByText('Oil change', { exact: true })).toHaveCount(0);
  await expect(page.locator('#maint-last-odo-input')).toHaveAttribute('placeholder', 'Default: unavailable');
});

test('a delayed mutation error body from the old vehicle cannot set an error for the new vehicle', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const originalJson = Response.prototype.json;
    Response.prototype.json = function () {
      if (this.headers.get('x-delay-test-json') === 'true') {
        (window as Window & { __maintenanceErrorBodyStarted?: boolean }).__maintenanceErrorBodyStarted = true;
        return originalJson.call(this).then(value => new Promise(resolve => setTimeout(() => resolve(value), 700)));
      }
      return originalJson.call(this);
    };
  });
  await page.route('**/api/maintenance*', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 400,
        headers: { 'x-delay-test-json': 'true' },
        json: { error: 'Old vehicle request failed' },
      });
    }
    const vehicleId = new URL(route.request().url()).searchParams.get('vehicle');
    return route.fulfill({ json: vehicleId === 'first' ? [schedule('first', 451)] : [] });
  });
  await page.route('**/api/maintenance/status*', route => {
    const vehicleId = new URL(route.request().url()).searchParams.get('vehicle');
    return route.fulfill({ json: status(vehicleId === 'first' ? 1 : 0) });
  });
  await page.route('**/api/fuel-logs*', route => route.fulfill({ json: [] }));

  await page.goto('/maintenance');
  await page.getByLabel('Schedule Name').fill('Brake inspection');
  await page.getByRole('button', { name: /Create Schedule/ }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __maintenanceErrorBodyStarted?: boolean }).__maintenanceErrorBodyStarted === true
  )).toBe(true);
  await selectVehicle(page, 'Second car');
  await expect(page.locator('#maint-last-odo-input')).toHaveAttribute('placeholder', 'Default: unavailable');
  await page.waitForTimeout(800);
  await expect(page.getByText('Old vehicle request failed')).toHaveCount(0);
});

test('a failed manual refresh after save is reported without an unhandled rejection', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const win = window as Window & { __unhandledMaintenanceRejections?: string[] };
    win.__unhandledMaintenanceRejections = [];
    window.addEventListener('unhandledrejection', event => {
      win.__unhandledMaintenanceRejections?.push(String(event.reason));
    });
  });
  await page.route('**/api/maintenance*', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { id: 'saved' } });
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/maintenance/status*', route => route.fulfill({ json: status(0) }));
  await page.route('**/api/fuel-logs*', route => route.fulfill({ status: 500, json: { error: 'local test failure' } }));

  await page.goto('/maintenance');
  await page.getByLabel('Schedule Name').fill('Brake inspection');
  await page.getByRole('button', { name: /Create Schedule/ }).click();
  await expect(page.getByText('Maintenance item created successfully!')).toBeVisible();
  await expect(page.locator('[role="alert"]').filter({ hasText: 'Fuel logs HTTP 500' })).toBeVisible();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() =>
    (window as Window & { __unhandledMaintenanceRejections?: string[] }).__unhandledMaintenanceRejections
  )).toEqual([]);
});

test('fuel-log fallback failure stays visible and does not partially apply schedule status', async ({ page }) => {
  await setup(page);
  await page.route('**/api/maintenance*', route => route.fulfill({ json: [] }));
  await page.route('**/api/maintenance/status*', route => route.fulfill({ json: status(7) }));
  await page.route('**/api/fuel-logs*', route => route.fulfill({ status: 500, json: { error: 'local test failure' } }));

  await page.goto('/maintenance');
  await expect(page.locator('[role="alert"]').filter({ hasText: 'Fuel logs HTTP 500' })).toBeVisible();
  await expect(page.locator('#maint-last-odo-input')).toHaveAttribute('placeholder', 'Default: unavailable');
  await expect(page.locator('.metric-summary-card').first()).toContainText('—');
  await expect(page.locator('.metric-summary-card').first()).not.toContainText('7');
});
