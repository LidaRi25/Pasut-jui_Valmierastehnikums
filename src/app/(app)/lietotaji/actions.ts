'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { FormState } from '@/components/action-form';
import { actionSysadmin, NO_PERMISSION } from '@/lib/auth';
import { fail, GENERIC_ERROR } from '@/lib/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['teacher', 'admin', 'sysadmin'] as const;

function generatePassword(): string {
  return randomBytes(9).toString('base64url') + '#7';
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email('Ievadiet derīgu e-pasta adresi.').max(254),
  full_name: z.string().trim().min(2, 'Norādiet vārdu un uzvārdu.').max(120),
  role: z.enum(ROLES),
  password: z.string().max(200).optional(),
});

/** Jauna lietotāja izveide (Supabase Auth admin API, tikai serverī). Publiska reģistrācija ir izslēgta. */
export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sys = await actionSysadmin();
  if (!sys) return NO_PERMISSION;
  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const { email, full_name, role } = parsed.data;
  const typed = (parsed.data.password ?? '').trim();
  if (typed && typed.length < 8) return { error: 'Parolei jābūt vismaz 8 simbolus garai.' };
  const password = typed || generatePassword();

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
  if (error || !data.user) {
    if (error?.code === 'email_exists' || /already/i.test(error?.message ?? '')) return { error: 'Lietotājs ar šādu e-pastu jau eksistē.' };
    console.error('[createUser]', error?.code, error?.message);
    return { error: GENERIC_ERROR };
  }
  if (role !== 'teacher') {
    const { error: roleError } = await admin.from('user_roles').update({ role }).eq('user_id', data.user.id);
    if (roleError) {
      console.error('[createUser role]', roleError.message);
      return { error: 'Lietotājs izveidots, bet lomu neizdevās iestatīt. Mainiet to sarakstā.' };
    }
  }
  revalidatePath('/lietotaji');
  return {
    ok: true,
    message: typed
      ? `Lietotājs ${email} izveidots.`
      : `Lietotājs ${email} izveidots. Pagaidu parole (parādīta tikai vienreiz): ${password}`,
  };
}

const updateSchema = z.object({
  id: z.string().regex(UUID_RE),
  full_name: z.string().trim().min(2, 'Norādiet vārdu un uzvārdu.').max(120),
  role: z.enum(ROLES),
});

/** Lietotāja vārda, lomas un aktivitātes maiņa (RLS: tikai sistēmas administrators; datubāze sargā pēdējo sistēmas administratoru) */
export async function updateUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sys = await actionSysadmin();
  if (!sys) return NO_PERMISSION;
  const parsed = updateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const { id, full_name, role } = parsed.data;
  const active = formData.get('is_active') === 'on';
  const supabase = await createClient();

  // Vispirms loma (var izgāzties ar VT_LAST_SYSADMIN), tad profils
  const r1 = await supabase.from('user_roles').update({ role }).eq('user_id', id).select('user_id');
  if (r1.error) return fail(r1.error);
  if (!r1.data?.length) return { error: 'Lietotājs nav atrasts.' };
  const r2 = await supabase.from('profiles').update({ full_name, is_active: active }).eq('id', id).select('id');
  if (r2.error) return fail(r2.error);

  // Deaktivizētam kontam papildus liedzam pieteikšanos Auth līmenī
  try {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
  } catch (e) {
    console.error('[updateUser ban]', e);
  }
  revalidatePath('/lietotaji');
  return { ok: true, message: 'Lietotājs saglabāts.' };
}

const pwSchema = z.object({ id: z.string().regex(UUID_RE), password: z.string().min(8, 'Parolei jābūt vismaz 8 simbolus garai.').max(200) });

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sys = await actionSysadmin();
  if (!sys) return NO_PERMISSION;
  const raw = Object.fromEntries(formData.entries());
  if (!String(raw.password ?? '').trim()) raw.password = generatePassword();
  const parsed = pwSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(parsed.data.id, { password: parsed.data.password });
  if (error) {
    console.error('[resetPassword]', error.message);
    return { error: GENERIC_ERROR };
  }
  return { ok: true, message: `Parole nomainīta. Jaunā parole (parādīta tikai vienreiz): ${parsed.data.password}` };
}

const grantSchema = z.object({ owner_id: z.string().regex(UUID_RE), grantee_id: z.string().regex(UUID_RE) });

/** Papildu tiesības: pedagogs (grantee) drīkst skatīt (un pēc izvēles labot) cita pedagoga (owner) pieteikumus */
export async function grantAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sys = await actionSysadmin();
  if (!sys) return NO_PERMISSION;
  const parsed = grantSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: 'Izvēlieties abus lietotājus.' };
  if (parsed.data.owner_id === parsed.data.grantee_id) return { error: 'Lietotājam nevar piešķirt piekļuvi pašam sev.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('teacher_access_grants')
    .upsert({ ...parsed.data, can_edit: formData.get('can_edit') === 'on', granted_by: sys.id }, { onConflict: 'owner_id,grantee_id' });
  if (error) return fail(error);
  revalidatePath('/lietotaji');
  return { ok: true, message: 'Piekļuve piešķirta.' };
}

export async function revokeAccessAction(formData: FormData): Promise<void> {
  const sys = await actionSysadmin();
  if (!sys) redirect('/?error=forbidden');
  const parsed = grantSchema.safeParse(Object.fromEntries(formData.entries()));
  if (parsed.success) {
    const supabase = await createClient();
    await supabase.from('teacher_access_grants').delete().eq('owner_id', parsed.data.owner_id).eq('grantee_id', parsed.data.grantee_id);
  }
  revalidatePath('/lietotaji');
}
