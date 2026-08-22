import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Set DASHBOARD_PASSWORD at deploy time; fallback keeps existing deployments working.
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'mathew1974';

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');
  const url = req.nextUrl;

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    // Allow any username with the dashboard password.
    if (pwd === DASHBOARD_PASSWORD) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Dashboard"',
    },
  });
}

// Protect all routes except static files
export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
