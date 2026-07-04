import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server-only file — never import this from a 'use client' component.

// Admin client: bypasses RLS, used in API routes.
// Fallback strings prevent module-evaluation crash during `next build`
// when env vars aren't yet resolved; they are never used at runtime.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL      ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY     ?? 'placeholder-service-role-key'
);

// Cookie-aware server client: used in Server Components and lib/auth.ts.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
