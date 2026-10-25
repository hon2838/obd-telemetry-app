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

test.describe('Theme Appearance & Color Scheme', () => {
  test('switches theme between Dark, Light, and System, verifying meta, localStorage, data-theme, and computed colors', async ({ page }) => {
    await page.route('**/api/vehicles', route => route.fulfill({ json: [mockVehicle] }));
    await page.goto('/');

    // Theme toggle button is present in the header
    const toggleBtn = page.locator('.desktop-nav .theme-toggle-btn');
    await expect(toggleBtn).toBeVisible();

    // Verify initial default is system ('light dark') or dark
    const initialMeta = await page.locator('meta[name="color-scheme"]').getAttribute('content');
    expect(['light dark', 'dark', 'light']).toContain(initialMeta);

    // 1. Switch to Light Mode via toggle button
    let currentScheme = await page.evaluate(() => localStorage.getItem('color-scheme'));
    for (let i = 0; i < 3 && currentScheme !== 'light'; i++) {
      await toggleBtn.click();
      currentScheme = await page.evaluate(() => localStorage.getItem('color-scheme'));
    }
    expect(currentScheme).toBe('light');

    // Verify DOM updates for Light Mode
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');

    // Verify computed background color matches light mode token (#f3f5f8 = rgb(243, 245, 248))
    const bodyBgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBgLight).toBe('rgb(243, 245, 248)');

    // 2. Switch to Dark Mode
    for (let i = 0; i < 3 && currentScheme !== 'dark'; i++) {
      await toggleBtn.click();
      currentScheme = await page.evaluate(() => localStorage.getItem('color-scheme'));
    }
    expect(currentScheme).toBe('dark');

    // Verify DOM updates for Dark Mode
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');

    // Verify computed background color matches dark mode token (#0f1318 = rgb(15, 19, 24))
    const bodyBgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBgDark).toBe('rgb(15, 19, 24)');

    // 3. Switch to System Mode
    for (let i = 0; i < 3 && currentScheme !== 'light dark'; i++) {
      await toggleBtn.click();
      currentScheme = await page.evaluate(() => localStorage.getItem('color-scheme'));
    }
    expect(currentScheme).toBe('light dark');

    // Verify DOM updates for System Mode
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();

    // 4. Also verify explicit selection on Account & Security page
    await page.goto('/account');
    const systemRadio = page.getByRole('radio', { name: /system/i });
    const lightRadio = page.getByRole('radio', { name: /light/i });
    const darkRadio = page.getByRole('radio', { name: /dark/i });

    await expect(systemRadio).toBeVisible();
    await expect(lightRadio).toBeVisible();
    await expect(darkRadio).toBeVisible();

    // Click Light on Account page
    await lightRadio.click();
    expect(await page.evaluate(() => localStorage.getItem('color-scheme'))).toBe('light');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    const bodyBgAccountLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBgAccountLight).toBe('rgb(243, 245, 248)');

    // Click Dark on Account page
    await darkRadio.click();
    expect(await page.evaluate(() => localStorage.getItem('color-scheme'))).toBe('dark');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    const bodyBgAccountDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBgAccountDark).toBe('rgb(15, 19, 24)');

    // Click System on Account page
    await systemRadio.click();
    expect(await page.evaluate(() => localStorage.getItem('color-scheme'))).toBe('light dark');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
  });

  test('theme radios support native tab and arrow-key selection', async ({ page }) => {
    await page.route('**/api/vehicles', route => route.fulfill({ json: [mockVehicle] }));
    await page.goto('/account');

    const group = page.getByRole('radiogroup', { name: 'Color scheme options' });
    const radios = group.getByRole('radio');
    const system = group.getByRole('radio', { name: 'System' });
    const light = group.getByRole('radio', { name: 'Light' });
    const dark = group.getByRole('radio', { name: 'Dark' });

    await system.check();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });

    // Tab enters the group at its checked radio; the next Tab leaves the whole group.
    let enteredGroup = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await page.keyboard.press('Tab');
      if (await system.evaluate(element => element === document.activeElement)) {
        enteredGroup = true;
        break;
      }
    }
    expect(enteredGroup).toBe(true);
    await expect(system).toBeFocused();
    await expect(system).toBeChecked();
    await expect(radios).toHaveCount(3);
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);

    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name))
      .not.toBe('color-scheme');
    await page.keyboard.press('Shift+Tab');
    await expect(system).toBeFocused();

    const pressAndCheck = async (key: string, selected: typeof system) => {
      await page.keyboard.press(key);
      await expect(selected).toBeFocused();
      await expect(selected).toBeChecked();
      await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => localStorage.getItem('color-scheme')))
        .toBe(await selected.getAttribute('value'));
    };

    await pressAndCheck('ArrowRight', light);
    await pressAndCheck('ArrowDown', dark);
    await pressAndCheck('ArrowLeft', light);
    await pressAndCheck('ArrowUp', system);
    await pressAndCheck('ArrowLeft', dark); // wraps backward
    await pressAndCheck('ArrowRight', system); // wraps forward
  });
});
