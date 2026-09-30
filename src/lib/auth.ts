import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdminRole, type AppRole } from '@/lib/labels';
import type { SessionUser } from '@/lib/types';

export type SessionState =
  | { status: 'anonymous' }
  | { status: 'inactive' }
  | { status: 'ok'; user: SessionUser };

/**
 * Nolasa autentificēto lietotāju no Supabase (getUser() pārbauda JWT ar Auth serveri — tam var uzticēties)
 * un viņa lomu no datubāzes. Rezultāts tiek kešots vienam pieprasījumam.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { status: 'anonymous' };
  const uid = data.user.id;

  const [{ data: profile, error: profileError }, { data: roleRow, error: roleError }] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, is_active').eq('id', uid).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', uid).maybeSingle(),
  ]);
  // Īslaicīga datubāzes kļūda nav "nav pieteicies": rādām kļūdas lapu, nevis raidām lietotāju ciklā starp /login un /
  if (profileError || roleError) {
    console.error('[session]', profileError?.code ?? roleError?.code, profileError?.message ?? roleError?.message);
    throw new Error('Neizdevās ielādēt lietotāja profilu.');
  }
  // Derīga Auth sesija, bet nav profila/lomas (piem., konts izveidots pirms trigera) — kā deaktivizēts konts:
  // /auth/inactive beidz sesiju un parāda saprotamu paziņojumu (citādi /login ↔ / nebeidzama novirzīšana)
  if (!profile || !roleRow || !profile.is_active) return { status: 'inactive' };
  return {
    status: 'ok',
    user: {
      id: uid,
      email: profile.email ?? data.user.email ?? '',
      fullName: profile.full_name || (profile.email ?? ''),
      role: roleRow.role as AppRole,
    },
  };
});

/** Pieprasa autentificētu lietotāju; citādi novirza uz pieteikšanās lapu. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (session.status === 'ok') return session.user;
  redirect(session.status === 'inactive' ? '/auth/inactive' : '/login');
}

/** Pieprasa pasūtītāja/administratora tiesības (admin vai sysadmin). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdminRole(user.role)) redirect('/?error=forbidden');
  return user;
}

/** Pieprasa sistēmas administratora tiesības. */
export async function requireSysadmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'sysadmin') redirect('/?error=forbidden');
  return user;
}

/**
 * Server Action variants: neveic novirzīšanu, bet atgriež null, ja tiesību nav
 * (Server Action pati nosaka, ko atbildēt lietotājam).
 */
export async function actionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session.status === 'ok' ? session.user : null;
}

export async function actionAdmin(): Promise<SessionUser | null> {
  const user = await actionUser();
  return user && isAdminRole(user.role) ? user : null;
}

export async function actionSysadmin(): Promise<SessionUser | null> {
  const user = await actionUser();
  return user && user.role === 'sysadmin' ? user : null;
}

export const NO_PERMISSION = { ok: false as const, error: 'Jums nav tiesību veikt šo darbību.' };
