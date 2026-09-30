'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { FormState } from '@/components/action-form';
import { actionAdmin, NO_PERMISSION } from '@/lib/auth';
import { fail } from '@/lib/errors';
import { formatDate, localRigaToIso } from '@/lib/format';
import { PERIOD_STATUSES } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({
  id: z.string().regex(UUID_RE).optional().or(z.literal('')),
  name: z.string().trim().max(120),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Norādiet sākuma datumu.'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Norādiet beigu datumu.'),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Norādiet iesniegšanas termiņu (datumu un laiku).'),
  status: z.enum(PERIOD_STATUSES as [string, ...string[]]),
});

/** Pasūtījuma perioda izveide / labošana (nosaukums, datumi, termiņš, statuss) */
export async function savePeriodAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const d = parsed.data;
  if (d.end_date < d.start_date) return { error: 'Beigu datums nedrīkst būt pirms sākuma datuma.' };
  const deadline = localRigaToIso(d.deadline);
  if (!deadline) return { error: 'Iesniegšanas termiņš nav derīgs.' };
  const name = d.name || `${formatDate(d.start_date)}–${formatDate(d.end_date)}`;
  const supabase = await createClient();
  const row = { name, start_date: d.start_date, end_date: d.end_date, submission_deadline: deadline, status: d.status };
  const { error } = d.id
    ? await supabase.from('order_periods').update(row).eq('id', d.id)
    : await supabase.from('order_periods').insert({ ...row, created_by: admin.id });
  if (error) return fail(error);
  revalidatePath('/periodi');
  revalidatePath('/', 'layout');
  return { ok: true, message: d.id ? 'Periods saglabāts.' : 'Periods izveidots.' };
}

const opSchema = z.object({
  period_id: z.string().regex(UUID_RE),
  op: z.enum(['open', 'close', 'collect', 'include', 'ordered', 'archive']),
  back: z.string().optional(),
});

/**
 * Perioda darbplūsma:
 *  open — atvērt; close — slēgt; collect — sākt apkopošanu;
 *  include — iesniegtos/apstiprinātos pieteikumus atzīmēt kā "Iekļauts pasūtījumā";
 *  ordered — pieteikumus atzīmēt kā "Pasūtīts" un periodu kā "Pasūtīts"; archive — arhivēt.
 * Visas izmaiņas nonāk audita vēsturē.
 */
export async function periodWorkflowAction(formData: FormData): Promise<void> {
  const admin = await actionAdmin();
  if (!admin) redirect('/?error=forbidden');
  const parsed = opSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/periodi');
  const { period_id, op, back } = parsed.data;
  const supabase = await createClient();
  const dest = back && back.startsWith('/') && !back.startsWith('//') ? back : `/pasutijums?period=${period_id}`;
  let error: { message?: string; code?: string } | null = null;
  const setPeriod = async (status: string) => (await supabase.from('order_periods').update({ status }).eq('id', period_id)).error;
  if (op === 'open') error = await setPeriod('open');
  else if (op === 'close') error = await setPeriod('closed');
  else if (op === 'collect') error = await setPeriod('collecting');
  else if (op === 'archive') error = await setPeriod('archived');
  else if (op === 'include') {
    error = (await supabase.from('requests').update({ status: 'included' }).eq('period_id', period_id).in('status', ['submitted', 'approved'])).error;
    if (!error) error = await setPeriod('collecting');
  } else if (op === 'ordered') {
    error = (await supabase.from('requests').update({ status: 'ordered' }).eq('period_id', period_id).in('status', ['submitted', 'approved', 'included'])).error;
    if (!error) error = await setPeriod('ordered');
  }
  revalidatePath('/pasutijums');
  revalidatePath('/pieteikumi');
  revalidatePath('/periodi');
  revalidatePath('/', 'layout');
  if (error) redirect(`${dest}${dest.includes('?') ? '&' : '?'}error=forbidden`);
  redirect(`${dest}${dest.includes('?') ? '&' : '?'}ok=saved`);
}
