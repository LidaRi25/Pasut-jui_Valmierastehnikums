'use server';

import { z } from 'zod';
import type { FormState } from '@/components/action-form';
import { actionUser, NO_PERMISSION } from '@/lib/auth';
import { fail } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

const nameSchema = z.object({ full_name: z.string().trim().min(2, 'Norādiet vārdu un uzvārdu.').max(120, 'Vārds ir pārāk garš.') });

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await actionUser();
  if (!user) return NO_PERMISSION;
  const parsed = nameSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_own_profile', { p_full_name: parsed.data.full_name });
  if (error) return fail(error);
  return { ok: true, message: 'Profils saglabāts.' };
}

const pwSchema = z
  .object({
    password: z.string().min(8, 'Parolei jābūt vismaz 8 simbolus garai.').max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Paroles nesakrīt.', path: ['confirm'] });

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await actionUser();
  if (!user) return NO_PERMISSION;
  const parsed = pwSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === 'same_password') return { error: 'Jaunā parole nedrīkst būt tāda pati kā pašreizējā.' };
    if (error.code === 'weak_password') return { error: 'Parole ir pārāk vāja. Izmantojiet garāku paroli.' };
    console.error('[changePassword]', error.code, error.message);
    return { error: 'Paroli neizdevās nomainīt. Mēģiniet vēlreiz.' };
  }
  return { ok: true, message: 'Parole nomainīta.' };
}
