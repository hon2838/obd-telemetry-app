import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');
  const url = req.nextUrl;

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    // User requested password "mathew1974". We'll allow any username with this password.
    if (pwd === 'mathew1974') {
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
