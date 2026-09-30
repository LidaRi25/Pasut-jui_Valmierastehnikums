'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { FormState } from '@/components/action-form';
import { actionAdmin, NO_PERMISSION } from '@/lib/auth';
import { fail } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  name: z.string().trim().min(1, 'Norādiet kategorijas nosaukumu.').max(100),
  sort_order: z.coerce.number().int().min(0).max(100000).default(0),
});

export async function saveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const supabase = await createClient();
  const { id, name, sort_order } = parsed.data;
  // Neatzīmēta izvēles rūtiņa formā netiek nosūtīta, tāpēc labošanas režīmā trūkstošs lauks = neaktīva
  const is_active = id ? formData.get('is_active') === 'on' : true;
  const { error } = id
    ? await supabase.from('product_categories').update({ name, sort_order, is_active }).eq('id', id)
    : await supabase.from('product_categories').insert({ name, sort_order });
  if (error) return error.code === '23505' ? { error: 'Šāda kategorija jau eksistē.' } : fail(error);
  revalidatePath('/katalogs', 'layout');
  return { ok: true, message: id ? 'Kategorija saglabāta.' : 'Kategorija pievienota.' };
}
