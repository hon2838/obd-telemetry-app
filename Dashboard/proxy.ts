import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BACKEND_BASE = (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PUBLIC_PAGES = new Set(['/login']);
const PUBLIC_AUTH_ROUTES = new Set(['/api/auth/login', '/api/auth/me', '/api/auth/logout', '/api/auth/change-password']);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PAGES.has(pathname) || PUBLIC_AUTH_ROUTES.has(pathname) || pathname === '/healthz') return NextResponse.next();

  const cookie = req.headers.get('cookie');
  const authorization = req.headers.get('authorization');
  if (!cookie && !authorization) {
    return pathname.startsWith('/api/') ? authenticationRequired(false) : redirectToLogin(req);
  }

  try {
    const headers: Record<string, string> = {};
    if (cookie) headers.Cookie = cookie;
    if (authorization) headers.Authorization = authorization;
    const meRes = await fetch(`${BACKEND_BASE}/api/auth/me`, {
      method: 'GET', headers, signal: AbortSignal.timeout(5000), cache: 'no-store',
    });
    if (meRes.ok) {
      const profile = await meRes.json();
      if (profile.mustChangePassword && pathname !== '/account' && !pathname.startsWith('/api/auth/')) {
        if (pathname.startsWith('/api/')) return new NextResponse(JSON.stringify({ error: 'Change your password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        const redirectUrl = req.nextUrl.clone();
        redirectUrl.pathname = '/account';
        redirectUrl.search = '';
        return NextResponse.redirect(redirectUrl);
      }
      return NextResponse.next();
    }
    if (meRes.status === 401 || meRes.status === 403) return pathname.startsWith('/api/') ? authenticationRequired(false) : redirectToLogin(req);
    return serviceUnavailable();
  } catch {
    return serviceUnavailable();
  }
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

function authenticationRequired(includeChallenge: boolean) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (includeChallenge) headers['WWW-Authenticate'] = 'Basic realm="Secure OBD Dashboard"';
  return new NextResponse(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers });
}

function serviceUnavailable() {
  return new NextResponse(JSON.stringify({ error: 'Authentication service unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } });
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico|healthz).*)' };
