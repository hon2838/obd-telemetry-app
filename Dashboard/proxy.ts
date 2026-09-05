import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BACKEND_BASE = (
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:3000'
).replace(/\/$/, '');

export async function proxy(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const url = req.nextUrl;

  if (authHeader) {
    try {
      const meRes = await fetch(`${BACKEND_BASE}/api/auth/me`, {
        method: 'GET',
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(5000),
      });

      if (meRes.ok) {
        const profile = await meRes.json();
        if (profile.mustChangePassword) {
          const isAccountRoute = url.pathname === '/account';
          const isApiAuthRoute = url.pathname.startsWith('/api/auth/');
          if (!isAccountRoute && !isApiAuthRoute && !url.pathname.startsWith('/api/')) {
            const redirectUrl = req.nextUrl.clone();
            redirectUrl.pathname = '/account';
            return NextResponse.redirect(redirectUrl);
          }
        }
        return NextResponse.next();
      }

      if (meRes.status === 401 || meRes.status === 403) {
        return authenticationRequired();
      }

      return new NextResponse('Authentication service unavailable', {
        status: 503,
        headers: { 'Retry-After': '5' },
      });
    } catch (_err) {
      return new NextResponse('Authentication service unavailable', {
        status: 503,
        headers: { 'Retry-After': '5' },
      });
    }
  }

  return authenticationRequired();
}

function authenticationRequired() {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure OBD Dashboard - Sign in with username and password"',
    },
  });
}

// Protect all routes except static files and the health probe. Pairing approval
// is authenticated even when a QR code links directly to /pair.
export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|healthz).*)',
};
