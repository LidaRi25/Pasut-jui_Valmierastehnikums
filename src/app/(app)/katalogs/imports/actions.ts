'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actionAdmin, NO_PERMISSION } from '@/lib/auth';
import { fail, type ActionResult } from '@/lib/errors';
import { ImportFileError, MAX_IMPORT_BYTES, parseImportFile } from '@/lib/import/parse';
import { createClient } from '@/lib/supabase/server';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();

export type ConflictKind = 'exact' | 'alias' | 'similar' | 'in_file';

export interface PreviewRow {
  index: number;
  line: number;
  name: string;
  unit_id: string | null;
  unit_code: string;
  category_id: string | null;
  category_name: string;
  packaging: string;
  notes: string;
  issues: string[];
  conflicts: Array<{ kind: ConflictKind; product: string }>;
  status: 'ok' | 'warning' | 'conflict' | 'error';
  include: boolean;
}

export interface PreviewData {
  fileName: string;
  rows: PreviewRow[];
  warnings: string[];
  truncated: boolean;
}

/** 1. solis: nolasa failu un sagatavo priekšskatījumu ar konfliktiem. Datubāzē netiek rakstīts nekas. */
export async function previewImportAction(formData: FormData): Promise<ActionResult<{ preview: PreviewData }>> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Izvēlieties failu (.xlsx vai .csv).' };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'Fails ir pārāk liels (maksimums 5 MB).' };

  let parsed;
  try {
    parsed = await parseImportFile(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (e) {
    if (e instanceof ImportFileError) return { ok: false, error: e.message };
    console.error('[import] parse', e);
    return { ok: false, error: 'Failu neizdevās nolasīt.' };
  }
  if (parsed.rows.length === 0) return { ok: false, error: 'Failā nav neviena preces ieraksta.' };

  const supabase = await createClient();
  const [{ data: units }, { data: cats }] = await Promise.all([
    supabase.from('units').select('id, code, name').eq('is_active', true),
    supabase.from('product_categories').select('id, name').eq('is_active', true),
  ]);
  const unitMap = new Map<string, { id: string; code: string }>();
  for (const u of units ?? []) {
    unitMap.set(norm(u.code).replace(/\.$/, ''), u);
    unitMap.set(norm(u.name), u);
  }
  const catMap = new Map((cats ?? []).map((c) => [norm(c.name), c]));

  // Līdzīgo/dublējošo preču meklēšana datubāzē (partijās, lai nepārsniegtu pieprasījuma izmēru)
  const conflicts = new Map<number, Array<{ kind: ConflictKind; product: string }>>();
  const names = parsed.rows.map((r) => r.name);
  for (let start = 0; start < names.length; start += 1000) {
    const slice = names.slice(start, start + 1000);
    const { data, error } = await supabase.rpc('find_similar_products', { p_names: slice });
    if (error) return fail(error);
    for (const m of (data ?? []) as Array<{ input_index: number; product_name: string; kind: string }>) {
      const idx = start + m.input_index - 1;
      const list = conflicts.get(idx) ?? [];
      list.push({ kind: m.kind === 'exact' ? 'exact' : m.kind === 'alias' ? 'alias' : 'similar', product: m.product_name });
      conflicts.set(idx, list);
    }
  }

  const seen = new Map<string, number>();
  const rows: PreviewRow[] = parsed.rows.map((r, i) => {
    const issues: string[] = [];
    const rowConflicts = [...(conflicts.get(i) ?? [])];
    let status: PreviewRow['status'] = 'ok';
    const key = norm(r.name);

    if (!r.name) issues.push('Trūkst preces nosaukuma.');
    else if (r.name.length > 200) issues.push('Nosaukums ir garāks par 200 simboliem.');
    if (r.packaging.length > 200) issues.push('Iepakojuma apraksts ir garāks par 200 simboliem.');
    if (r.notes.length > 500) issues.push('Piezīme ir garāka par 500 simboliem.');

    const unit = r.unit ? unitMap.get(norm(r.unit).replace(/\.$/, '')) : undefined;
    if (!r.unit) issues.push('Nav norādīta mērvienība.');
    else if (!unit) issues.push(`Nezināma mērvienība «${r.unit}».`);

    let category: { id: string; name: string } | undefined;
    if (r.category) {
      category = catMap.get(norm(r.category));
      if (!category) issues.push(`Kategorija «${r.category}» nav atrasta — prece tiks importēta bez kategorijas.`);
    }

    if (key && seen.has(key)) rowConflicts.push({ kind: 'in_file', product: `dublē ${seen.get(key)}. rindu failā` });
    else if (key) seen.set(key, r.line);

    const hardError = !r.name || r.name.length > 200 || r.packaging.length > 200 || r.notes.length > 500 || !unit;
    const hasExact = rowConflicts.some((c) => c.kind === 'exact' || c.kind === 'alias' || c.kind === 'in_file');
    if (hardError) status = 'error';
    else if (hasExact) status = 'conflict';
    else if (rowConflicts.length > 0 || issues.length > 0) status = 'warning';

    return {
      index: i,
      line: r.line,
      name: r.name,
      unit_id: unit?.id ?? null,
      unit_code: unit?.code ?? r.unit,
      category_id: category?.id ?? null,
      category_name: category?.name ?? r.category,
      packaging: r.packaging,
      notes: r.notes,
      issues,
      conflicts: rowConflicts,
      status,
      // Noklusēti: kļūdainos un precīzos dublikātus neimportē; līdzīgos (bet atšķirīgos) atstāj administratora ziņā — atzīmēti
      include: status === 'ok' || status === 'warning',
    };
  });

  return { ok: true, preview: { fileName: file.name, rows, warnings: parsed.warnings, truncated: parsed.truncated } };
}

const rowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  unit_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  category_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).nullable(),
  package_description: z.string().max(200).nullable(),
  notes: z.string().max(500).nullable(),
});

/** 2. solis: importē administratora izvēlētās rindas. Esošie nosaukumi tiek izlaisti (nekas netiek pārrakstīts vai apvienots). */
export async function commitImportAction(rowsJson: string): Promise<ActionResult<{ inserted: number; skipped: number }>> {
  const admin = await actionAdmin();
  if (!admin) return NO_PERMISSION;
  let raw: unknown;
  try {
    raw = JSON.parse(rowsJson);
  } catch {
    return { ok: false, error: 'Importa dati nav derīgi.' };
  }
  const parsed = z.array(rowSchema).min(1).max(20000).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Importa dati nav derīgi. Sāciet importu no jauna.' };

  const supabase = await createClient();
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < parsed.data.length; i += 1000) {
    const { data, error } = await supabase.rpc('import_products', { p_rows: parsed.data.slice(i, i + 1000) });
    if (error) return fail(error);
    const r = data as { inserted: number; skipped: number };
    inserted += r.inserted;
    skipped += r.skipped;
  }
  revalidatePath('/katalogs', 'layout');
  return { ok: true, inserted, skipped };
}
