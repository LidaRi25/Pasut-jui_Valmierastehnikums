'use server';

import { UUID_RE } from '@/lib/uuid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { FormState } from '@/components/action-form';
import { actionAdmin, NO_PERMISSION } from '@/lib/auth';
import { fail } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

const opt = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const schema = z.object({
  id: z.string().regex(UUID_RE),
  intent: z.enum(['approve', 'merge', 'reject']),
  name: z.string().max(200).nullable(),
  category_id: z.string().regex(UUID_RE).nullable(),
  unit_id: z.string().regex(UUID_RE).nullable(),
  target: z.string().regex(UUID_RE).nullable(),
  note: z.string().max(500).nullable(),
});

/** Jaunas preces ierosinājuma izskatīšana: apstiprināt (ar pārdēvēšanu/kategoriju), pievienot kā sinonīmu esošai precei, noraidīt */
export async function resolveProposalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const parsed = schema.safeParse({
    id: formData.get('id'),
    intent: formData.get('intent'),
    name: opt(formData.get('name')),
    category_id: opt(formData.get('category_id')),
    unit_id: opt(formData.get('unit_id')),
    target: opt(formData.get('target')),
    note: opt(formData.get('note')),
  });
  if (!parsed.success) return { error: 'Pārbaudiet ievadītos datus.' };
  const d = parsed.data;
  if (d.intent === 'merge' && !d.target) return { error: 'Izvēlieties esošo preci, kurai pievienot kā sinonīmu.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('resolve_product_proposal', {
    p_proposal_id: d.id,
    p_action: d.intent,
    p_name: d.name,
    p_category_id: d.category_id,
    p_unit_id: d.unit_id,
    p_target_id: d.target,
    p_note: d.note,
  });
  if (error) return fail(error);
  revalidatePath('/jaunas-preces');
  revalidatePath('/katalogs', 'layout');
  revalidatePath('/');
  // Kartīte pēc lēmuma pazūd no saraksta, tāpēc apstiprinājumu rādām lapas augšā (novirzīšana)
  redirect(`/jaunas-preces?done=${d.intent}`);
}
