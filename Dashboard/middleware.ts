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

      // Check User Account authentication against backend server candidates
      const candidateHosts = [
        process.env.INTERNAL_API_URL,
        'http://server:3000',
        'http://127.0.0.1:3000',
        process.env.NEXT_PUBLIC_API_URL,
      ].filter(Boolean) as string[];

      for (const host of candidateHosts) {
        try {
          const loginRes = await fetch(`${host.replace(/\/$/, '')}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user || 'admin', password: pwd }),
          });
          if (loginRes.ok) {
            return NextResponse.next();
          }
          if (loginRes.status === 401 || loginRes.status === 400) {
            // Server responded with explicit bad credentials
            break;
          }
        } catch (_e) {
          // Network connection error, try next candidate
        }
      }
    } catch (_err) {
      // Fallback
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure OBD Dashboard - Sign in with username and password"',
    },
  });
}

// Protect all routes except static files, healthz probe, and QR code pairing
export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|healthz|pair).*)',
};
