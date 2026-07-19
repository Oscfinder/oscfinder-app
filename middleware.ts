import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  // Redirect a logged-in visitor away from these — there's no reason to show
  // a fully logged-in user the login form. Deliberately excludes
  // /reset-password AND /forgot-password: verifyOtp()/exchangeCodeForSession()
  // on /reset-password establishes a real login session as soon as a recovery
  // link is verified (that's how Supabase's recovery flow works — verify
  // first, *then* set the password while authenticated), and a
  // not-yet-completed recovery leaves exactly that kind of session sitting
  // around. Someone in that state clicking "Request a New Link" needs to
  // actually reach /forgot-password, not get bounced to the dashboard because
  // they technically have a session — that session doesn't mean their
  // password was ever set.
  const guestOnlyPaths = ['/login'];
  // Never force these through the "not logged in → /login" redirect either —
  // both need to be reachable mid-flow, before or after a session exists.
  const authOnlyPaths = ['/login', '/forgot-password', '/reset-password'];
  // Accessible regardless of login state -- no redirect either direction.
  const openPaths = ['/api-docs', '/swagger.json'];

  // Build a Supabase client that can read/write cookies in middleware
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh the session if it has expired. An expired/invalid refresh token
  // (e.g. an aggressively short access-token expiry, or a token issued before
  // a project-level auth setting change) can make getUser() throw rather than
  // return { user: null } — without this try/catch, that crashes the whole
  // middleware function (no response at all, not even a redirect), which is
  // exactly what a raw platform error page with no redirect looks like. Any
  // failure here is treated the same as "not logged in".
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  // If logged in and visiting login/forgot-password → send to dashboard
  if (user && guestOnlyPaths.includes(pathname)) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // If NOT logged in and visiting a protected page → send to /login
  if (!user && !authOnlyPaths.includes(pathname) && !openPaths.includes(pathname)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return res;
}

// Run middleware on everything EXCEPT static files and API routes
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
};
