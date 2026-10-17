import { test, expect } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

const mockVehicle = { id: 'car-test-1', name: 'Perodua Axia SE', tankLitres: 36 };

test.beforeEach(async ({ page }) => {
  test.skip(!e2eConfigured(), 'Disposable backend credentials required');
  await establishCachedBrowserSession(page);
});

test.describe('Telemetry Workspace Navigation & Shell', () => {
  test('header renders branding, vehicle context, and accessible More dropdown', async ({ page }) => {
    await page.route('**/api/vehicles', route => route.fulfill({ json: [mockVehicle] }));
    await page.goto('/');

    // Branding
    await expect(page.locator('.header-brand')).toContainText('OBD Telemetry');

    // Vehicle picker
    const vehicleBtn = page.locator('.vehicle-picker-btn');
    await expect(vehicleBtn).toBeVisible();
    await expect(vehicleBtn).toContainText('Perodua Axia SE');

    // More dropdown menu
    const moreBtn = page.getByRole('button', { name: 'More navigation options', exact: true });
    await expect(moreBtn).toBeVisible();
    await expect(page.locator('.more-dropdown-menu')).toHaveCount(0);

    // Click More to open menu
    await moreBtn.click();
    const moreMenu = page.locator('.more-dropdown-menu');
    await expect(moreMenu).toBeVisible();
    await expect(moreMenu.getByText('Fuel & Economy')).toBeVisible();
    await expect(moreMenu.getByText('Maintenance')).toBeVisible();
    await expect(moreMenu.getByText('Diagnostics & Codes')).toBeVisible();
    await expect(moreMenu.getByText('Performance')).toBeVisible();
    await expect(moreMenu.getByText('Garage & Fleet')).toBeVisible();
    await expect(moreMenu.getByText('Pair Car (QR/PIN)')).toBeVisible();
    await expect(moreMenu.getByText('Account & Security')).toBeVisible();
    await expect(moreMenu.getByText('Sign out')).toBeVisible();

    // Escape closes the menu
    await page.keyboard.press('Escape');
    await expect(page.locator('.more-dropdown-menu')).toHaveCount(0);
  });

  test('mobile viewport at 320px renders compact header and usable drawer', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/api/vehicles', route => route.fulfill({ json: [mockVehicle] }));
    await page.goto('/');

    // Desktop nav is hidden
    await expect(page.locator('.desktop-nav')).not.toBeVisible();

    // Mobile menu toggle is visible
    const menuBtn = page.locator('.mobile-menu-btn');
    await expect(menuBtn).toBeVisible();

    // Open drawer
    await menuBtn.click();
    const drawer = page.locator('.mobile-nav-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Readings')).toBeVisible();
    await expect(drawer.getByText('Overview')).toBeVisible();
    await expect(drawer.getByText('Trips')).toBeVisible();
    await expect(drawer.getByText('Sign out')).toBeVisible();

    // Close drawer
    await menuBtn.click();
    await expect(page.locator('.mobile-nav-drawer')).toHaveCount(0);
  });
});

test.describe('Overview Page', () => {
  test('renders period summaries, recent journeys, and latest snapshot', async ({ page }) => {
    const startTime = Date.now() - 3600000;
    const mockDrives = [{
      id: 'drive-ov-1',
      startTime,
      endTime: startTime + 1800000,
      label: 'Morning commute',
      summary: {
        durationMin: 30,
        distanceKm: 18.5,
        avgSpeed: 45,
        fuelEfficiencyKmL: 15.2,
        estimatedFuelEconomyKmL: 15.2,
        quality: { fuelCoverageRatio: 0.95 }
      }
    }];
    const mockLatest = {
      timestamp: Date.now() - 60000,
      speed: 52,
      rpm: 1850,
      coolantTemp: 88,
      voltage: 13.8,
      fuelLevel: 65
    };

    await page.route('**/api/vehicles', route => route.fulfill({ json: [mockVehicle] }));
    await page.route('**/api/drives*', route => route.fulfill({ json: mockDrives }));
    await page.route('**/api/telemetry/latest*', route => route.fulfill({ json: mockLatest }));
    await page.route('**/api/maintenance/status*', route => route.fulfill({ json: { okCount: 3, dueSoonCount: 0, overdueCount: 0 } }));
    await page.route('**/api/dtc*', route => route.fulfill({ json: [] }));

    await page.goto('/overview');

    // Page title
    await expect(page.locator('h1')).toContainText('Overview');

    // Summaries
    await expect(page.getByText('Recorded distance today')).toBeVisible();
    await expect(page.getByText('Trips recorded today')).toBeVisible();
    await expect(page.getByText('Last trip economy')).toBeVisible();

    // Recent Journeys Table
    await expect(page.getByText('Recent Journeys')).toBeVisible();
    await expect(page.locator('table')).toContainText('18.5 km');
    await expect(page.locator('table')).toContainText('15.2');

    // Last recorded readings
    await expect(page.getByText('Last Recorded Readings')).toBeVisible();
    await expect(page.getByText('52 km/h')).toBeVisible();
    await expect(page.getByText('1,850 RPM')).toBeVisible();
  });
});

test.describe('Readings Page Layout & Truthful Freshness', () => {
  test('puts essential signals first and renders compact GPS unavailable card when no coordinates', async ({ page }) => {
    const mockTelemetry = {
      timestamp: Date.now() - 30000,
      speed: 48,
      rpm: 1600,
      coolantTemp: 86,
      voltage: 13.9,
      fuelLevel: null,
      latitude: 0,
      longitude: 0,
      estimatedFuelEconomyKmL: 16.0,
      estimatedFuelRateLph: 3.0
    };

    await page.route('**/api/vehicles', route => route.fulfill({ json: [mockVehicle] }));
    await page.route('**/api/telemetry/snapshot*', route => route.fulfill({ json: { records: [mockTelemetry], snapshotCursor: 1 } }));

    await page.goto('/');

    // Truthful freshness
    const freshness = page.locator('.data-freshness-bar');
    await expect(freshness).toBeVisible();
    await expect(freshness).toContainText('Recent sample');

    // Essential metrics visible
    await expect(page.getByText('Engine Speed', { exact: true })).toBeVisible();
    await expect(page.getByText('1,600')).toBeVisible();
    await expect(page.getByText('Estimated fuel economy', { exact: true })).toBeVisible();
    await expect(page.getByTestId('fuel-rate')).toHaveText('Estimated fuel rate: 3.0 L/h');

    // Compact GPS unavailable card (not a 450px blank hero)
    await expect(page.getByText('GPS location unavailable')).toBeVisible();
    await expect(page.getByText('No satellite coordinates received in recent sample')).toBeVisible();
  });
});

test.describe('Diagnostics Command Confirmation', () => {
  test('clear fault codes requires explicit confirmation with vehicle context', async ({ page }) => {
    await page.route('**/api/vehicles', route => route.fulfill({ json: [mockVehicle] }));
    await page.route('**/api/telemetry/dtc*', route => route.fulfill({ json: { latest: { latestDtc: { code: '' } }, history: [] } }));
    await page.route('**/api/commands/status*', route => route.fulfill({ json: { commands: [] } }));

    let postedPayload: any = null;
    await page.route('**/api/commands', async route => {
      if (route.request().method() === 'POST') {
        postedPayload = route.request().postDataJSON();
        await route.fulfill({ status: 201, json: { commandId: 'cmd-clear-1', status: 'queued' } });
      } else {
        await route.continue();
      }
    });

    await page.goto('/diagnostics');

    // Novice command buttons
    const readBtn = page.getByRole('button', { name: /read fault codes/i });
    const clearBtn = page.getByRole('button', { name: /clear fault codes/i });
    await expect(readBtn).toBeVisible();
    await expect(clearBtn).toBeVisible();

    // Click clear button opens confirmation dialog (role=dialog on inner panel)
    await clearBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Clear fault codes for');
    await expect(dialog).toContainText('Mode 04 Diagnostic Command Confirmation');

    // Cancel closes dialog without submitting command
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(postedPayload).toBeNull();

    // Re-open and confirm command POST scoped to selected vehicle
    await clearBtn.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm Clear Codes' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(postedPayload).toMatchObject({
      command: 'clear_dtc',
      vehicleId: mockVehicle.id
    });
  });
});
