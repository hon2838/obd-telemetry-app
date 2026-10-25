import { test, expect } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

// Run against a disposable local backend, using its test-only API key.
for (const sample of [
  { name: 'idle zero', value: 0, rate: 1.06, age: 0, expected: '0.0', expectedRate: '1.1 L/h', state: 'Latest synced reading' },
  { name: 'moving estimate', value: 12.5, rate: 4.8, age: 0, expected: '12.5', expectedRate: '4.8 L/h', state: 'Latest synced reading' },
  { name: 'unavailable inputs', value: null, rate: null, age: 0, expected: 'N/A', expectedRate: 'N/A', state: 'Estimate unavailable or incomplete' },
  { name: 'legacy missing rate', value: 12.5, rate: undefined, age: 0, expected: '12.5', expectedRate: 'N/A', state: 'Estimate unavailable or incomplete' },
  { name: 'rate without economy', value: null, rate: 1.06, age: 0, expected: 'N/A', expectedRate: '1.1 L/h', state: 'Estimate unavailable or incomplete' },
  { name: 'freshness boundary', value: 12.5, rate: 4.8, age: 90000, expected: '12.5', expectedRate: '4.8 L/h', state: 'Latest synced reading' },
  { name: 'stale sample', value: 12.5, rate: 4.8, age: 90001, expected: 'N/A', expectedRate: 'N/A', state: 'Reading too old' },
  { name: 'future sample', value: 12.5, rate: 4.8, age: -10000, expected: 'N/A', expectedRate: 'N/A', state: 'Awaiting fresh reading' },
]) {
  test(`fuel economy displays ${sample.name} correctly`, async ({ page, request }) => {
    test.skip(!e2eConfigured() || !process.env.E2E_API_KEY, 'Disposable backend credentials and E2E_API_KEY required');
    const backend = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:3000';
    const headers = { 'x-api-key': process.env.E2E_API_KEY! };
    const vehicleId = `fuel-ui-${Date.now()}-${sample.age}`;
    const now = Date.now();
    // Freeze the browser's wall time, keeping timers active, so the exact
    // 90-second threshold does not drift during navigation and assertions.
    await page.clock.setFixedTime(new Date(now));
    const create = await request.post(`${backend}/api/vehicles`, {
      headers, data: { vehicleId, name: 'Fuel display test' },
    });
    expect(create.status()).toBe(201);
    const ingest = await request.post(`${backend}/api/telemetry/batch`, {
      headers, data: [{ vehicleId, eventId: vehicleId, timestamp: now - sample.age,
        speed: sample.value === 0 ? 0 : 60, rpm: 1000, latitude: 0, longitude: 0,
        altitude: 0, gpsSpeed: 0, coolantTemp: null, engineLoad: null,
        throttlePos: null, fuelLevel: null, ambientTemp: null, voltage: null,
        accelTime: null, alertCoolant: false, alertVoltage: false,
        estimatedFuelEconomyKmL: sample.value, estimatedFuelRateLph: sample.rate }],
    });
    expect(ingest.status()).toBe(201);
    await establishCachedBrowserSession(page);
    await page.addInitScript(id => localStorage.setItem('obd_active_vehicle_id', id), vehicleId);
    const snapshot = page.waitForResponse(response =>
      response.url().includes('/api/telemetry/snapshot') &&
      new URL(response.url()).searchParams.get('vehicle') === vehicleId && response.status() === 200);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('/');
    const data = await (await snapshot).json();
    // JSON history can retain null, while SQLite omits nullable optional fields.
    // Both mean unavailable; nullish normalization must still preserve zero.
    expect(data.records[0].estimatedFuelEconomyKmL ?? null).toBe(sample.value);
    if (sample.rate !== undefined) expect(data.records[0].estimatedFuelRateLph ?? null).toBe(sample.rate);
    await expect(page.locator('.glass-panel').filter({
      has: page.getByText('Engine Speed', { exact: true }),
    })).toContainText('1,000');
    const card = page.locator('.glass-panel').filter({
      has: page.getByText('Estimated fuel economy', { exact: true }),
    });
    await expect(card).toContainText(sample.expected);
    await expect(card).toContainText('Petrol estimate');
    await expect(card).toContainText(sample.state);
    await expect(card.getByTestId('fuel-rate')).toHaveText(`Estimated fuel rate: ${sample.expectedRate}`);
    if (sample.expected !== 'N/A') await expect(card).toContainText('km/L');
    else await expect(card).not.toContainText('km/L');
    if (sample.name === 'moving estimate') {
      await page.screenshot({ path: 'test-results/fuel-economy-kml.png', fullPage: true });
      // Simulate a lost connection: the previous figure must not look current.
      await page.route('**/api/telemetry/**', route => route.abort());
      await expect(card).toContainText('Disconnected', { timeout: 20000 });
      await expect(card.getByTestId('fuel-rate')).toHaveText('Estimated fuel rate: N/A');
      await expect(card).not.toContainText('km/L');
      await expect(card).not.toContainText('L/h');
    }
    if (sample.name === 'idle zero') {
      await page.clock.setFixedTime(new Date(now + 90001));
      await expect(card).toContainText('Reading too old');
      await expect(card.getByTestId('fuel-rate')).toHaveText('Estimated fuel rate: N/A');
      await expect(card).not.toContainText('km/L');
    }
    expect(pageErrors).toEqual([]);
  });
}
