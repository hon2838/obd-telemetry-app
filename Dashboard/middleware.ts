import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Set DASHBOARD_PASSWORD at deploy time. We do NOT provide a
// fallback default: if it's missing, the dashboard renders 503
// on every page rather than silently accepting an unauthenticated
// request. A previous fallback ('mathew1974') was the textbook
// "default credentials" footgun and was removed.
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
if (!DASHBOARD_PASSWORD || DASHBOARD_PASSWORD.length < 12) {
  // Throw at module load so the build fails fast in CI. (In
  // production, the page simply 503s; we don't want a misconfigured
  // deploy to be silently "open by default".)
  throw new Error(
    'DASHBOARD_PASSWORD env var is missing or < 12 chars. ' +
    'Set it in your deploy config (see deployment_guide.md).'
  );
}

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
