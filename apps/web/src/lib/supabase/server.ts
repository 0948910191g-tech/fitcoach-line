import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabasePublicEnv } from '../../../../../packages/config/src/env';

function secureCookieOptions<T extends Record<string, unknown>>(options: T): T & {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
} {
  return {
    ...options,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

export async function createSupabaseServerClient() {
  const env = getSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set(name, value, secureCookieOptions(options));
          } catch {
            // Server Components cannot mutate cookies. The root proxy refreshes the session cookie.
          }
        }
      },
    },
  });
}
