import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic route protection (edge): pages require a Better Auth session cookie, otherwise the
 * visitor is sent to /sign-in. The session itself is validated by Better Auth on every API call
 * (`/api/auth/token`), and the NestJS API verifies the resulting JWT — this is UX, not security.
 */
const PUBLIC_PATHS = ['/sign-in'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('callbackUrl', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, static files and API route handlers (which protect themselves).
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|txt)$).*)'],
};
