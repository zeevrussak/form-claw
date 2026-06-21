import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

const WHITELISTED_EMAILS = [
  'k6622024@gmail.com',
  'targetmailbox@gmail.com',
  '2396119@gmail.com',
  'zeev@infiniplex.life',
  'russakbot@gmail.com',
  'john@doe.com',
];

export default withAuth(
  function middleware(req) {
    const email = req?.nextauth?.token?.email?.toLowerCase() ?? '';
    if (email && !WHITELISTED_EMAILS.includes(email)) {
      return NextResponse.redirect(new URL('/login?error=AccessDenied', req.url));
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/activity/:path*',
    '/statistics/:path*',
    '/errors/:path*',
    '/system/:path*',
    '/api/logs/:path*',
    '/api/stats/:path*',
    '/api/system/:path*',
  ],
};
