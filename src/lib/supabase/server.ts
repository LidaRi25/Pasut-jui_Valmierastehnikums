import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cookieSecure, supabasePublicKey, supabaseUrl } from '@/lib/env';

/** Supabase klients ar pašreizējā lietotāja sesiju (sīkdatnes) — visas vaicājumus filtrē RLS. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabasePublicKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure: cookieSecure() });
          }
        } catch {
          // Server Component kontekstā sīkdatnes nevar rakstīt; sesiju atjauno proxy.ts
        }
      },
    },
  });
}
