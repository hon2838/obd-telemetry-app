import { test, expect } from '@playwright/test';

test.describe('OBD Dashboard Tests', () => {
  test.use({
    extraHTTPHeaders: {
      'Authorization': 'Basic ' + Buffer.from('admin:mathew1974').toString('base64'),
    },
  });
  test('Trips Explorer page renders correctly', async ({ page }) => {
    await page.goto('http://localhost:3001/trips');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('Account & Security page renders all sections', async ({ page }) => {
    await page.goto('http://localhost:3001/account');
    await expect(page.locator('text=Account & Device Security')).toBeVisible();
    await expect(page.locator('text=Change Password')).toBeVisible();
    await expect(page.locator('text=Paired Car Head Units')).toBeVisible();
    await expect(page.locator('input[placeholder="Enter new strong password"]')).toBeVisible();
  });

  test('Pair Car page renders PIN input and vehicle selection', async ({ page }) => {
    await page.goto('http://localhost:3001/pair');
    await expect(page.locator('text=Pair Car Head Unit')).toBeVisible();
    await expect(page.locator('text=6-Digit Pairing PIN')).toBeVisible();
    await expect(page.locator('text=Assign to Vehicle Profile')).toBeVisible();
    await expect(page.locator('button:has-text("Authorize & Link Car Head Unit")')).toBeVisible();
  });

  test('Garage & Fleet page renders multi-vehicle hub', async ({ page }) => {
    await page.goto('http://localhost:3001/garage');
    await expect(page.locator('text=Garage & Fleet Hub')).toBeVisible();
    await expect(page.locator('text=Registered Vehicles')).toBeVisible();
  });
});
