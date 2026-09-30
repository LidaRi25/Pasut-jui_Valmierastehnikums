// Kopīgi palīgi skriptiem (Node 20+). Izmanto SERVICE ROLE atslēgu — palaist tikai uzticamā vidē.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Trūkst NEXT_PUBLIC_SUPABASE_URL vai SUPABASE_SERVICE_ROLE_KEY.');
    console.error('Palaidiet ar:  node --env-file=.env.local scripts/<skripts>.mjs');
    process.exit(1);
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function randomPassword() {
  return randomBytes(12).toString('base64url') + 'a1';
}

export function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Atrod vai izveido lietotāju; atgriež { id, created, password? } */
export async function ensureUser(sb, { email, fullName, password }) {
  // Meklējam visās lapās (nevis tikai pirmajos 1000 lietotājos)
  let existing;
  for (let page = 1; !existing; page++) {
    const { data: list, error: listError } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (listError) throw listError;
    existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (list.users.length < 1000) break;
  }
  if (existing) return { id: existing.id, created: false };
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return { id: data.user.id, created: true, password };
}

export async function setRole(sb, userId, role) {
  const { error } = await sb.from('user_roles').update({ role }).eq('user_id', userId);
  if (error) throw error;
}
