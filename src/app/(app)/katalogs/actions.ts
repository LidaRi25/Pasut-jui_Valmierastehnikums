'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { FormState } from '@/components/action-form';
import { actionAdmin, actionUser, NO_PERMISSION } from '@/lib/auth';
import { parseDecimal } from '@/lib/decimal';
import { fail } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE);
const optUuid = z.preprocess((v) => (v === '' || v === null ? null : v), uuid.nullable());
const optText = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable());

const productSchema = z.object({
  name: z.string().trim().min(1, 'Norādiet preces nosaukumu.').max(200, 'Nosaukums ir pārāk garš.'),
  category_id: optUuid,
  base_unit_id: uuid,
  order_unit_id: uuid,
  package_description: optText(200),
  package_quantity: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
  barcode: optText(64),
  notes: optText(500),
});

function parsePackageQty(raw: string): { ok: true; value: string | null } | { ok: false } {
  if (raw.trim() === '') return { ok: true, value: null };
  const p = parseDecimal(raw);
  if (!p.ok || p.value.startsWith('-') || p.value === '0') return { ok: false };
  return { ok: true, value: p.value };
}

function formToObject(fd: FormData) {
  return Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
}

/** Administrators pievieno jaunu (uzreiz apstiprinātu) preci katalogā */
export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const parsed = productSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const pkg = parsePackageQty(parsed.data.package_quantity);
  if (!pkg.ok) return { error: 'Daudzums iepakojumā nav derīgs skaitlis.' };
  const supabase = await createClient();
  const { package_quantity: _ignored, ...rest } = parsed.data;
  void _ignored;
  const { data, error } = await supabase
    .from('products')
    .insert({ ...rest, package_quantity: pkg.value, approval_status: 'approved', is_active: true })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { error: 'Šāda prece jau ir katalogā (nosaukums atkārtojas).' };
    return fail(error);
  }
  revalidatePath('/katalogs');
  redirect(`/katalogs/${data.id}?ok=created`);
}

export async function updateProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) return { error: 'Ieraksts nav atrasts.' };
  const parsed = productSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const pkg = parsePackageQty(parsed.data.package_quantity);
  if (!pkg.ok) return { error: 'Daudzums iepakojumā nav derīgs skaitlis.' };
  const { package_quantity: _ignored, ...rest } = parsed.data;
  void _ignored;
  const supabase = await createClient();
  const { error } = await supabase
    .from('products')
    .update({ ...rest, package_quantity: pkg.value, is_active: formData.get('is_active') === 'on' })
    .eq('id', id);
  if (error) {
    if (error.code === '23505') return { error: 'Cita prece ar šādu nosaukumu jau eksistē. Ja tā ir tā pati prece, izmantojiet apvienošanu.' };
    return fail(error);
  }
  revalidatePath('/katalogs');
  revalidatePath(`/katalogs/${id}`);
  return { ok: true, message: 'Izmaiņas saglabātas.' };
}

const aliasSchema = z.object({ product_id: uuid, alias: z.string().trim().min(1, 'Norādiet sinonīmu.').max(200) });

export async function addAliasAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const parsed = aliasSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const supabase = await createClient();
  const { error } = await supabase.from('product_aliases').insert(parsed.data);
  if (error) return error.code === '23505' ? { error: 'Šāds sinonīms jau ir piesaistīts kādai precei.' } : fail(error);
  revalidatePath(`/katalogs/${parsed.data.product_id}`);
  return { ok: true, message: 'Sinonīms pievienots.' };
}

export async function deleteAliasAction(formData: FormData): Promise<void> {
  const admin = await actionAdmin();
  if (!admin) redirect('/?error=forbidden');
  const id = String(formData.get('id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  if (UUID_RE.test(id)) {
    const supabase = await createClient();
    await supabase.from('product_aliases').delete().eq('id', id);
  }
  revalidatePath(`/katalogs/${productId}`);
}

/** Sinonīma pāradresēšana uz citu esošu preci */
export async function moveAliasAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const id = String(formData.get('id') ?? '');
  const from = String(formData.get('product_id') ?? '');
  const target = String(formData.get('target') ?? '');
  if (!UUID_RE.test(id) || !UUID_RE.test(target)) return { error: 'Izvēlieties preci, uz kuru pāradresēt sinonīmu.' };
  const supabase = await createClient();
  const { error } = await supabase.from('product_aliases').update({ product_id: target }).eq('id', id);
  if (error) return fail(error);
  revalidatePath('/katalogs', 'layout');
  // Sinonīms pazūd no šīs preces saraksta, tāpēc apstiprinājumu rādām pēc novirzīšanas
  redirect(UUID_RE.test(from) ? `/katalogs/${from}?ok=saved` : '/katalogs?ok=saved');
}

/** Kļūdaini izveidota produkta apvienošana ar pareizo */
export async function mergeProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const source = String(formData.get('source') ?? '');
  const target = String(formData.get('target') ?? '');
  if (!UUID_RE.test(source) || !UUID_RE.test(target)) return { error: 'Izvēlieties preci, ar kuru apvienot.' };
  if (source === target) return { error: 'Nevar apvienot preci pašu ar sevi.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('merge_products', { p_source: source, p_target: target });
  if (error) return fail(error);
  revalidatePath('/katalogs', 'layout');
  redirect(`/katalogs/${target}?ok=saved`);
}

const proposeFormSchema = z.object({
  name: z.string().trim().min(2, 'Norādiet preces nosaukumu (vismaz 2 simboli).').max(200),
  unit_id: uuid,
  category_id: optUuid,
  notes: optText(500),
});

/** Pedagogs ierosina jaunu preci no kataloga lapas */
export async function proposeProductFormAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await actionUser();
  if (!user) return NO_PERMISSION;
  const parsed = proposeFormSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('propose_product', {
    p_name: parsed.data.name,
    p_unit_id: parsed.data.unit_id,
    p_category_id: parsed.data.category_id,
    p_notes: parsed.data.notes,
  });
  if (error) return fail(error);
  revalidatePath('/jaunas-preces');
  revalidatePath('/katalogs');
  return { ok: true, message: 'Prece ierosināta. Jūs varat to izmantot pieteikumā; administrators to apstiprinās.' };
}
