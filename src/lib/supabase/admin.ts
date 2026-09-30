import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseServiceKey, supabaseUrl } from '@/lib/env';

/**
 * Service-role klients — APIET RLS. Drīkst izmantot tikai serverī pēc skaidras lomas pārbaudes
 * (lietotāju izveide, paroles atiestatīšana). Nekad neizmantot lietotāja datu vaicājumiem.
 */
export function createAdminClient() {
  return createClient(supabaseUrl(), supabaseServiceKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
