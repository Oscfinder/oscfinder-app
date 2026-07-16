import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

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

  // Refresh the session if it has expired
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

  const authOnlyPaths = ['/login', '/forgot-password', '/reset-password'];
  // Accessible regardless of login state -- no redirect either direction.
  const openPaths = ['/api-docs', '/swagger.json'];

  // If logged in and visiting an auth page → send to dashboard
  if (user && authOnlyPaths.includes(pathname)) {
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
