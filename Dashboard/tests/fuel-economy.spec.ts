import { test, expect } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

// Run against a disposable local backend, using its test-only API key.
for (const sample of [
  { name: 'idle zero', value: 0, age: 0, expected: '0.0' },
  { name: 'moving estimate', value: 12.5, age: 0, expected: '12.5' },
  { name: 'unavailable inputs', value: null, age: 0, expected: 'N/A' },
  { name: 'stale sample', value: 12.5, age: 91000, expected: 'N/A' },
]) {
  test(`fuel economy displays ${sample.name} correctly`, async ({ page, request }) => {
    test.skip(!e2eConfigured() || !process.env.E2E_API_KEY, 'Disposable backend credentials and E2E_API_KEY required');
    const backend = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:3000';
    const headers = { 'x-api-key': process.env.E2E_API_KEY! };
    const vehicleId = `fuel-ui-${Date.now()}-${sample.age}`;
    const create = await request.post(`${backend}/api/vehicles`, {
      headers, data: { vehicleId, name: 'Fuel display test' },
    });
    expect(create.status()).toBe(201);
    const ingest = await request.post(`${backend}/api/telemetry/batch`, {
      headers, data: [{ vehicleId, eventId: vehicleId, timestamp: Date.now() - sample.age,
        speed: sample.value === 0 ? 0 : 60, rpm: 1000, latitude: 0, longitude: 0,
        altitude: 0, gpsSpeed: 0, coolantTemp: null, engineLoad: null,
        throttlePos: null, fuelLevel: null, ambientTemp: null, voltage: null,
        accelTime: null, alertCoolant: false, alertVoltage: false,
        estimatedFuelEconomyKmL: sample.value }],
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
    expect(data.records[0].estimatedFuelEconomyKmL).toBe(sample.value);
    await expect(page.locator('.glass-panel').filter({
      has: page.getByText('Engine Speed', { exact: true }),
    })).toContainText('1000');
    const card = page.locator('.glass-panel').filter({
      has: page.getByText('Estimated fuel economy', { exact: true }),
    });
    await expect(card).toContainText(sample.expected);
    await expect(card).toContainText('Petrol estimate');
    if (sample.expected !== 'N/A') await expect(card).toContainText('km/L');
    else await expect(card).not.toContainText('km/L');
    if (sample.name === 'moving estimate') {
      await page.screenshot({ path: 'test-results/fuel-economy-kml.png', fullPage: true });
      // Simulate a lost connection: the previous figure must not look current.
      await page.route('**/api/telemetry/**', route => route.abort());
      await expect(card).toContainText('N/A', { timeout: 20000 });
    }
    expect(pageErrors).toEqual([]);
  });
}
