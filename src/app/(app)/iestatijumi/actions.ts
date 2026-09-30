'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { FormState } from '@/components/action-form';
import { actionSysadmin, NO_PERMISSION } from '@/lib/auth';
import { parseDecimal } from '@/lib/decimal';
import { fail } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

const settingsSchema = z.object({
  institution_name: z.string().trim().min(1, 'Norādiet iestādes nosaukumu.').max(120),
  autosave_seconds: z.coerce.number().int().min(0, 'Autosaglabāšanas aizkave nedrīkst būt negatīva.').max(120),
  print_footer: z.string().trim().max(300),
});

export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sys = await actionSysadmin();
  if (!sys) return NO_PERMISSION;
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const supabase = await createClient();
  const rows = [
    { key: 'institution_name', value: parsed.data.institution_name, updated_by: sys.id },
    { key: 'autosave_seconds', value: parsed.data.autosave_seconds, updated_by: sys.id },
    { key: 'print_footer', value: parsed.data.print_footer, updated_by: sys.id },
  ];
  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Iestatījumi saglabāti.' };
}

const unitSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  code: z.string().trim().min(1, 'Norādiet mērvienības apzīmējumu.').max(20),
  name: z.string().trim().min(1, 'Norādiet nosaukumu.').max(60),
  sort_order: z.coerce.number().int().min(0).max(100000).default(0),
  warn_quantity: z.string().optional(),
});

/** Mērvienību pārvaldība (sistēmas administrators). Brīdinājuma slieksnis izmantots "neparasti liela daudzuma" paziņojumam pieteikumā. */
export async function saveUnitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sys = await actionSysadmin();
  if (!sys) return NO_PERMISSION;
  const parsed = unitSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const d = parsed.data;
  let warn: string | null = null;
  if ((d.warn_quantity ?? '').trim() !== '') {
    const p = parseDecimal(d.warn_quantity);
    if (!p.ok || p.value.startsWith('-') || p.value === '0') return { error: 'Brīdinājuma slieksnim jābūt skaitlim, lielākam par 0.' };
    warn = p.value;
  }
  const supabase = await createClient();
  const row = {
    code: d.code,
    name: d.name,
    sort_order: d.sort_order,
    warn_quantity: warn,
    is_countable: formData.get('is_countable') === 'on',
    ...(d.id ? { is_active: formData.get('is_active') === 'on' } : {}),
  };
  const { error } = d.id ? await supabase.from('units').update(row).eq('id', d.id) : await supabase.from('units').insert(row);
  if (error) return error.code === '23505' ? { error: 'Šāda mērvienība jau eksistē.' } : fail(error);
  revalidatePath('/', 'layout');
  return { ok: true, message: d.id ? 'Mērvienība saglabāta.' : 'Mērvienība pievienota.' };
}
