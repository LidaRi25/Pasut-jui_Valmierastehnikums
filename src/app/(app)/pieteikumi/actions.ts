'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actionAdmin, actionUser, NO_PERMISSION } from '@/lib/auth';
import { fail, GENERIC_ERROR, type ActionResult } from '@/lib/errors';
import { REQUEST_STATUSES, type RequestStatus } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import type { ProductHit } from '@/lib/types';
import { UUID_RE } from '@/lib/uuid';

const uuid = z.string().regex(UUID_RE);
const nullableUuid = uuid.nullable();

const dataSchema = z.object({
  period_id: nullableUuid,
  course_id: nullableUuid,
  group_id: nullableUuid,
  students: z.string().max(500),
  topic: z.string().max(300),
  lesson_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  student_count: z.number().int().min(0).max(10000).nullable(),
  notes: z.string().max(2000),
  // Optimistiskā bloķēšana: pēdējā zināmā pieteikuma versija (updated_at, teksts)
  expected_updated_at: z.string().max(64).nullable().optional(),
});

const itemSchema = z.object({
  id: uuid,
  product_id: uuid,
  unit_id: uuid,
  quantity: z
    .string()
    .regex(/^\d{1,11}(\.\d{1,3})?$/)
    .nullable(),
  notes: z.string().max(500).nullable(),
});

const payloadSchema = z.object({
  id: uuid.nullable(),
  data: dataSchema,
  items: z.array(itemSchema).max(500),
});

export type SaveResult = ActionResult<{ id: string; requestNo: number; updatedAt: string }>;

async function persist(input: unknown): Promise<SaveResult & { parsedId?: string }> {
  const user = await actionUser();
  if (!user) return NO_PERMISSION;
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Ievadītie dati nav derīgi. Pārbaudiet datumu un daudzumus.' };
  const { id, data, items } = parsed.data;
  const supabase = await createClient();
  const { data: saved, error } = await supabase.rpc('save_request', { p_id: id, p_data: data, p_items: items });
  if (error) return fail(error);
  const r = saved as { id: string; request_no: number; updated_at: string };
  return { ok: true, id: r.id, requestNo: r.request_no, updatedAt: r.updated_at };
}

/** Saglabā pieteikumu kā melnrakstu / saglabā izmaiņas (autosave izmanto to pašu ceļu). */
export async function saveRequestAction(input: unknown): Promise<SaveResult> {
  // Apzināti bez revalidatePath: autosave nedrīkst izraisīt lapas pārrenderēšanu, kamēr lietotājs raksta.
  return persist(input);
}

/** Saglabā un iesniedz pieteikumu. Validāciju veic datubāze (nav apejama). */
export async function submitRequestAction(input: unknown): Promise<SaveResult> {
  const saved = await persist(input);
  if (!saved.ok) return saved;
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_request', { p_id: saved.id });
  if (error && !(error.message ?? '').includes('VT_ALREADY_SUBMITTED')) return fail(error);
  // Bez revalidatePath: klients pēc veiksmes pāriet uz pieteikuma lapu (dinamiska, vienmēr svaiga); revalidācija
  // pārrenderētu pašreizējo maršrutu un uz mirkli nodzēstu formu.
  return saved;
}

export async function deleteRequestAction(formData: FormData): Promise<void> {
  const user = await actionUser();
  if (!user) redirect('/login');
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) redirect('/pieteikumi');
  const supabase = await createClient();
  const { data, error } = await supabase.from('requests').delete().eq('id', id).select('id');
  if (error || !data?.length) redirect(`/pieteikumi/${id}?error=forbidden`);
  revalidatePath('/pieteikumi');
  redirect('/pieteikumi?ok=deleted');
}

export async function copyRequestAction(formData: FormData): Promise<void> {
  const user = await actionUser();
  if (!user) redirect('/login');
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) redirect('/pieteikumi');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('copy_request', { p_id: id });
  if (error || !data) redirect(`/pieteikumi/${id}?error=forbidden`);
  const r = data as { id: string; copied: number; skipped: number };
  revalidatePath('/pieteikumi');
  redirect(`/pieteikumi/${r.id}?copied=${r.copied}&skipped=${r.skipped}`);
}

const proposeSchema = z.object({
  name: z.string().trim().min(2).max(200),
  unit_id: uuid,
  category_id: nullableUuid,
  notes: z.string().trim().max(500),
});

/** Pedagogs ierosina jaunu preci; tā uzreiz izmantojama viņa pieteikumā, bet administratoram jāapstiprina. */
export async function proposeProductAction(input: unknown): Promise<ActionResult<{ product: ProductHit }>> {
  const user = await actionUser();
  if (!user) return NO_PERMISSION;
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Norādiet preces nosaukumu (vismaz 2 simboli) un mērvienību.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('propose_product', {
    p_name: parsed.data.name,
    p_unit_id: parsed.data.unit_id,
    p_category_id: parsed.data.category_id,
    p_notes: parsed.data.notes || null,
  });
  if (error) return fail(error);
  const created = data as { id: string };
  const { data: hit, error: hitError } = await supabase
    .from('products')
    .select('id, name, category_id, base_unit_id, order_unit_id, package_description, package_quantity, approval_status')
    .eq('id', created.id)
    .single();
  if (hitError || !hit) return { ok: false, error: GENERIC_ERROR };
  const [{ data: unit }, { data: cat }] = await Promise.all([
    supabase.from('units').select('code').eq('id', hit.order_unit_id).single(),
    hit.category_id ? supabase.from('product_categories').select('name').eq('id', hit.category_id).single() : Promise.resolve({ data: null }),
  ]);
  // Bez revalidatePath: tiek izsaukta no pieteikuma redaktora, kura formu nedrīkst pārmontēt (skat. saveRequestAction)
  return {
    ok: true,
    product: {
      id: hit.id,
      name: hit.name,
      category_id: hit.category_id,
      category_name: (cat as { name: string } | null)?.name ?? null,
      unit_id: hit.order_unit_id,
      unit_code: unit?.code ?? '',
      base_unit_id: hit.base_unit_id,
      base_unit_code: unit?.code ?? '',
      package_description: hit.package_description,
      package_quantity: hit.package_quantity,
      approval_status: hit.approval_status,
      matched_alias: null,
    },
  };
}

const bulkSchema = z.object({
  ids: z.array(uuid).min(1).max(500),
  status: z.enum(REQUEST_STATUSES as [RequestStatus, ...RequestStatus[]]),
});

export interface BulkState {
  ok?: boolean;
  error?: string;
  count?: number;
}

/** Administrators maina vairāku pieteikumu statusu (Apstiprināts, Iekļauts pasūtījumā, Pasūtīts, Atcelts …). */
export async function setRequestStatusAction(_prev: BulkState | undefined, formData: FormData): Promise<BulkState> {
  const admin = await actionAdmin();
  if (!admin) return { error: NO_PERMISSION.error };
  const parsed = bulkSchema.safeParse({ ids: formData.getAll('id').map(String), status: formData.get('status') });
  if (!parsed.success) return { error: 'Atzīmējiet pieteikumus un izvēlieties statusu.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('requests').update({ status: parsed.data.status }).in('id', parsed.data.ids).select('id');
  if (error) return { error: fail(error).error };
  revalidatePath('/pieteikumi');
  revalidatePath('/pasutijums');
  revalidatePath('/');
  return { ok: true, count: data?.length ?? 0 };
}
