import { test, expect } from '@playwright/test';
import { E2E_USERNAME, e2eConfigured, apiLogin, cachedApiLogin, establishBrowserSession, invalidateE2ESession } from './e2e-auth';

// Genuine session integration through the Next proxy (/api/* -> backend):
// cookie login, CSRF denial/success, password reset, logout revocation and
// stale vehicle/cursor handling. All against the disposable backend account
// from the environment; no hardcoded credentials.
test.describe.serial('Session integration through the Next proxy', () => {
  test.beforeEach(async () => {
    test.skip(!e2eConfigured(), 'E2E_PASSWORD is not set for the disposable backend account');
  });

  test('cookie login via the UI sets an HttpOnly session cookie', async ({ page }) => {
    const session = await apiLogin(page);
    await page.goto('/login');
    await page.locator('#login-username').fill(E2E_USERNAME);
    await page.locator('#login-password').fill(session.password);
    await page.locator('button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'obd_session');
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie?.httpOnly).toBe(true);
  });

  test('cookie-authenticated mutation without a CSRF token is denied', async ({ page }) => {
    const session = await cachedApiLogin(page);
    const denied = await page.request.post('/api/fuel-logs', {
      headers: { Cookie: session.cookie },
      data: { litres: 1, odometer: 1, vehicleId: 'default' },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json().catch(() => ({})))?.code).toBe('CSRF_REQUIRED');
  });

  test('cookie-authenticated mutation with a CSRF token succeeds through the proxy', async ({ page }) => {
    const session = await cachedApiLogin(page);
    const litres = 7.77;
    const odometer = 90000 + Math.floor(Math.random() * 1000) + 0.5;
    const created = await page.request.post('/api/fuel-logs', {
      headers: { Cookie: session.cookie, 'x-csrf-token': session.csrfToken },
      data: { litres, odometer, vehicleId: 'default', source: 'web' },
    });
    expect(created.status()).toBe(201);
    expect(created.headers()['set-cookie'] ?? '').not.toContain('obd_session=;');

    // Best-effort cleanup so the disposable backend stays tidy.
    const list = await page.request.get('/api/fuel-logs?vehicle=default', {
      headers: { Cookie: session.cookie },
    });
    if (list.ok()) {
      const entries = await list.json().catch(() => []);
      const match = Array.isArray(entries) ? entries.find((e: { litres?: number }) => e?.litres === litres) : null;
      if (match?.id !== undefined) {
        await page.request.delete(`/api/fuel-logs/${match.id}`, {
          headers: { Cookie: session.cookie, 'x-csrf-token': session.csrfToken },
        });
      }
    }
  });

  test('password reset rejects weak and wrong credentials without mutating state', async ({ page }) => {
    const session = await cachedApiLogin(page);
    const short = await page.request.post('/api/auth/change-password', {
      headers: { Cookie: session.cookie, 'x-csrf-token': session.csrfToken },
      data: { currentPassword: session.password, newPassword: 'short' },
    });
    expect(short.status()).toBe(400);
    const wrong = await page.request.post('/api/auth/change-password', {
      headers: { Cookie: session.cookie, 'x-csrf-token': session.csrfToken },
      data: { currentPassword: 'definitely-not-the-disposable-password', newPassword: 'AnotherDisposablePass123!' },
    });
    expect(wrong.status()).toBe(400);
    // The session still works after the rejected rotations.
    const me = await page.request.get('/api/auth/me', { headers: { Cookie: session.cookie } });
    expect(me.ok()).toBe(true);
  });

  test('logout revokes the session and protected pages redirect to login', async ({ page }) => {
    const session = await establishBrowserSession(page);
    await page.goto('/garage');
    await expect(page).not.toHaveURL(/\/login/);

    const logout = await page.request.post('/api/auth/logout', {
      headers: { Cookie: session.cookie, 'x-csrf-token': session.csrfToken },
    });
    expect(logout.status()).toBe(200);

    const me = await page.request.get('/api/auth/me', { headers: { Cookie: session.cookie } });
    expect(me.status()).toBe(401);

    await page.goto('/garage');
    await expect(page).toHaveURL(/\/login/);
    invalidateE2ESession();
  });

  test('stale vehicle and cursor inputs are rejected, live cursor shape holds', async ({ page }) => {
    const session = await cachedApiLogin(page);
    const headers = { Cookie: session.cookie };

    const unknownVehicle = await page.request.get('/api/telemetry/latest?vehicle=no-such-vehicle', { headers });
    expect([400, 403]).toContain(unknownVehicle.status());

    const badCursor = await page.request.get('/api/telemetry/changes?cursor=not-a-number', { headers });
    expect(badCursor.status()).toBe(400);

    const negativeCursor = await page.request.get('/api/telemetry/changes?cursor=-1', { headers });
    expect(negativeCursor.status()).toBe(400);

    const firstPage = await page.request.get('/api/telemetry/changes?cursor=0&limit=5', { headers });
    expect(firstPage.ok()).toBe(true);
    const body = await firstPage.json();
    expect(Array.isArray(body.records)).toBe(true);
    expect(typeof body.nextCursor).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
  });
});
