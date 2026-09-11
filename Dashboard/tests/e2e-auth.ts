import type { Page } from '@playwright/test';

// Shared helpers for the dashboard browser suite. All credentials come from
// the environment (disposable backend account); nothing is hardcoded.
export const E2E_USERNAME = process.env.E2E_USERNAME || 'admin';
export const E2E_PASSWORD = process.env.E2E_PASSWORD || '';
export const E2E_NEW_PASSWORD = process.env.E2E_NEW_PASSWORD || '';

export function e2eConfigured(): boolean {
  return E2E_PASSWORD.length > 0;
}

function parseSetCookie(header: string | null): { name: string; value: string } | null {
  if (!header) return null;
  const first = header.split(',').map(part => part.trim()).find(part => part.startsWith('obd_session='))
    || header.split(';')[0];
  const match = /obd_session=([^;]*)/.exec(first);
  if (!match) return null;
  return { name: 'obd_session', value: decodeURIComponent(match[1]) };
}

export interface E2ESession {
  cookie: string;
  csrfToken: string;
  password: string;
}

// Log in through the Next proxy (/api/auth/login -> backend) and return the
// session cookie plus CSRF token. Handles the forced-password-reset gate: on
// a fresh disposable backend the bootstrap account must rotate its password
// first, which is exactly the genuine reset flow under test.
export async function apiLogin(page: Page): Promise<E2ESession> {
  const candidates = [E2E_PASSWORD, E2E_NEW_PASSWORD].filter(p => p.length > 0);
  let lastError = '';
  for (const password of candidates) {
    const response = await page.request.post('/api/auth/login', {
      data: { username: E2E_USERNAME, password },
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok()) {
      if (body.mustChangePassword || body?.user?.mustChangePassword) {
        if (!E2E_NEW_PASSWORD) throw new Error('Account requires a password reset but E2E_NEW_PASSWORD is not set');
        if (!body.csrfToken) throw new Error('Login response did not include a csrfToken for the reset');
        const loginSetCookie = response.headers()['set-cookie'] || '';
        const loginCookie = parseSetCookie(loginSetCookie);
        const resetHeaders: Record<string, string> = { 'x-csrf-token': body.csrfToken };
        if (loginCookie) resetHeaders.Cookie = `${loginCookie.name}=${loginCookie.value}`;
        const reset = await page.request.post('/api/auth/change-password', {
          headers: resetHeaders,
          data: { currentPassword: password, newPassword: E2E_NEW_PASSWORD },
        });
        if (!reset.ok()) throw new Error(`Forced password reset failed: HTTP ${reset.status()}`);
        const relogin = await page.request.post('/api/auth/login', {
          data: { username: E2E_USERNAME, password: E2E_NEW_PASSWORD },
        });
        const reloginBody = await relogin.json().catch(() => ({}));
        if (!relogin.ok()) throw new Error(`Re-login after reset failed: HTTP ${relogin.status()}`);
        const setCookie = relogin.headers()['set-cookie'] || '';
        const parsed = parseSetCookie(setCookie);
        if (!parsed) throw new Error('Re-login did not set an obd_session cookie');
        return { cookie: `${parsed.name}=${parsed.value}`, csrfToken: reloginBody.csrfToken, password: E2E_NEW_PASSWORD };
      }
      const setCookie = response.headers()['set-cookie'] || '';
      const parsed = parseSetCookie(setCookie);
      if (!parsed) throw new Error('Login did not set an obd_session cookie');
      if (!body.csrfToken) throw new Error('Login response did not include a csrfToken');
      return { cookie: `${parsed.name}=${parsed.value}`, csrfToken: body.csrfToken, password };
    }
    lastError = body?.error || `HTTP ${response.status()}`;
  }
  throw new Error(`API login failed for disposable account ${E2E_USERNAME}: ${lastError}`);
}

// Establish the same cookie session inside the browser context so page
// navigations are authenticated.
export async function establishBrowserSession(page: Page): Promise<E2ESession> {
  const session = await apiLogin(page);
  await page.context().addCookies([{
    name: 'obd_session',
    value: session.cookie.slice('obd_session='.length),
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
  }]);
  return session;
}

// One session per test file: the backend rate-limits /api/auth/login, so
// tests within a file share a session instead of logging in per test. Call
// invalidateE2ESession() after a test deliberately revokes its session.
let cachedSession: E2ESession | null = null;

export function invalidateE2ESession() {
  cachedSession = null;
}

export async function cachedApiLogin(page: Page): Promise<E2ESession> {
  if (!cachedSession) cachedSession = await apiLogin(page);
  return cachedSession;
}

export async function establishCachedBrowserSession(page: Page): Promise<E2ESession> {
  const session = await cachedApiLogin(page);
  await page.context().addCookies([{
    name: 'obd_session',
    value: session.cookie.slice('obd_session='.length),
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
  }]);
  return session;
}
