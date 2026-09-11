import { test, expect } from '@playwright/test';
import { e2eConfigured, establishCachedBrowserSession } from './e2e-auth';

test.describe('OBD Dashboard pages', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!e2eConfigured(), 'E2E_PASSWORD is not set for the disposable backend account');
    await establishCachedBrowserSession(page);
  });

  test('Login page renders the session form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h2')).toHaveText('Sign in');
    await expect(page.locator('#login-username')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
  });

  test('Trips Explorer page renders correctly', async ({ page }) => {
    await page.goto('/trips');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('Account & Security page renders all sections', async ({ page }) => {
    await page.goto('/account');
    await expect(page.locator('text=Account & Device Security')).toBeVisible();
    await expect(page.locator('text=Change Password')).toBeVisible();
    await expect(page.locator('text=Paired Car Head Units')).toBeVisible();
    await expect(page.locator('input[placeholder="Enter new strong password"]')).toBeVisible();
  });

  test('Pair Car page renders PIN input and vehicle selection', async ({ page }) => {
    await page.goto('/pair');
    await expect(page.locator('text=Pair Car Head Unit')).toBeVisible();
    await expect(page.locator('text=6-Digit Pairing PIN')).toBeVisible();
    await expect(page.locator('text=Assign to Vehicle Profile')).toBeVisible();
    await expect(page.locator('button:has-text("Authorize & Link Car Head Unit")')).toBeVisible();
  });

  test('Garage & Fleet page renders multi-vehicle hub', async ({ page }) => {
    await page.goto('/garage');
    await expect(page.locator('text=Garage & Fleet Hub')).toBeVisible();
    await expect(page.locator('text=Registered Vehicles')).toBeVisible();
  });
});

test.describe('Unauthenticated proxy gate', () => {
  test('protected pages redirect to login without a session', async ({ page }) => {
    await page.goto('/garage');
    await expect(page).toHaveURL(/\/login/);
  });
});
