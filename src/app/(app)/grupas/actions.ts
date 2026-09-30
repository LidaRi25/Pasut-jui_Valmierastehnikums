'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { FormState } from '@/components/action-form';
import { actionSysadmin, NO_PERMISSION } from '@/lib/auth';
import { fail } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({
  kind: z.enum(['group', 'course']),
  id: z.string().uuid().optional().or(z.literal('')),
  name: z.string().trim().min(1, 'Norādiet nosaukumu.').max(100, 'Nosaukums ir pārāk garš.'),
  sort_order: z.coerce.number().int().min(0).max(100000).optional(),
});

/** Grupu un kursu pārvaldība (sistēmas administrators) */
export async function saveGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sys = await actionSysadmin();
  if (!sys) return NO_PERMISSION;
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const { kind, id, name, sort_order } = parsed.data;
  const supabase = await createClient();
  const table = kind === 'group' ? 'groups' : 'courses';
  const is_active = id ? formData.get('is_active') === 'on' : true;
  const payload = kind === 'group' ? { name, is_active } : { name, is_active, sort_order: sort_order ?? 0 };
  const { error } = id
    ? await supabase.from(table).update(payload).eq('id', id)
    : await supabase.from(table).insert(kind === 'group' ? { name } : { name, sort_order: sort_order ?? 0 });
  if (error) return error.code === '23505' ? { error: 'Šāds nosaukums jau eksistē.' } : fail(error);
  revalidatePath('/grupas');
  revalidatePath('/', 'layout');
  return { ok: true, message: id ? 'Saglabāts.' : 'Pievienots.' };
}
