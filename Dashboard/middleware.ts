import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

export async function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');
  const url = req.nextUrl;

  // 1. Check HTTP Basic Auth (supports both DASHBOARD_PASSWORD and User Account login like admin / admin12345)
  if (basicAuth) {
    try {
      const authValue = basicAuth.split(' ')[1];
      const decoded = atob(authValue);
      const colonIdx = decoded.indexOf(':');
      const user = colonIdx !== -1 ? decoded.substring(0, colonIdx) : 'admin';
      const pwd = colonIdx !== -1 ? decoded.substring(colonIdx + 1) : decoded;

      // Check legacy DASHBOARD_PASSWORD if set
      if (DASHBOARD_PASSWORD && pwd === DASHBOARD_PASSWORD) {
        return NextResponse.next();
      }

      // Check User Account authentication against backend server
      const apiHost = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://server:3000';
      const loginRes = await fetch(`${apiHost}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user || 'admin', password: pwd }),
      });

      if (loginRes.ok) {
        return NextResponse.next();
      }
    } catch (_err) {
      // Fallback
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure OBD Dashboard — Sign in with your username and password (e.g. admin / admin12345)"',
    },
  });
}

// Protect all routes except static files, healthz probe, and QR code pairing
export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|healthz|pair).*)',
};
