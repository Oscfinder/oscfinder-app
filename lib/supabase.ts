import { createBrowserClient } from '@supabase/ssr';

// Browser client using createBrowserClient (from @supabase/ssr).
// This stores the session in cookies instead of localStorage,
// so the middleware and server components can read it.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);