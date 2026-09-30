import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { periodLabel } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { REQUEST_STATUS_LABEL } from '@/lib/labels';
import { effectiveStatuses, toRpcArgs, type OrderFilters } from '@/lib/order-filters';
import type { OrderLine, ReportRow, SummaryRow } from '@/lib/types';
import { numStr } from '@/lib/decimal';

type Client = SupabaseClient;

/** Normalizē PostgREST numeric (JSON skaitļi) uz tekstu */
function fixSummary(rows: SummaryRow[]): SummaryRow[] {
  return rows.map((r) => ({
    ...r,
    total_quantity: numStr(r.total_quantity) ?? '0',
    equivalent_quantity: numStr(r.equivalent_quantity),
    request_count: Number(r.request_count),
    teacher_count: Number(r.teacher_count),
  }));
}

export async function loadSummary(supabase: Client, f: OrderFilters): Promise<SummaryRow[]> {
  const args = toRpcArgs(f);
  return fixSummary(await fetchAll<SummaryRow>(() => supabase.rpc('get_order_summary', args) as never));
}

export async function loadLines(supabase: Client, f: OrderFilters): Promise<OrderLine[]> {
  const args = toRpcArgs(f);
  const rows = await fetchAll<OrderLine>(() => supabase.rpc('order_lines', args) as never);
  return rows.map((r) => ({ ...r, quantity: numStr(r.quantity) ?? '0' }));
}

export type Dimension = 'teacher' | 'group' | 'course' | 'date' | 'category';

export async function loadReport(supabase: Client, dimension: Dimension, f: OrderFilters): Promise<ReportRow[]> {
  const args = { p_dimension: dimension, ...toRpcArgs(f) };
  const rows = await fetchAll<ReportRow>(() => supabase.rpc('get_order_report', args) as never);
  return rows.map((r) => ({ ...r, total_quantity: numStr(r.total_quantity) ?? '0', request_count: Number(r.request_count) }));
}

/** Filtru apraksts latviešu valodā (Excel galvenei un pārskatiem) */
export async function describeFilters(
  supabase: Client,
  f: OrderFilters,
  ref: { periods: Array<{ id: string; name: string; start_date: string; end_date: string }>; groups: Array<{ id: string; name: string }>; courses: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }> },
): Promise<{ periodLabel: string | null; lines: string[] }> {
  const lines: string[] = [];
  const period = f.period ? ref.periods.find((p) => p.id === f.period) : undefined;
  if (f.from || f.to) lines.push(`Nodarbību datums: ${f.from ? formatDate(f.from) : '…'} – ${f.to ? formatDate(f.to) : '…'}`);
  if (f.teacher) {
    const { data } = await supabase.from('profiles').select('full_name').eq('id', f.teacher).maybeSingle();
    if (data) lines.push(`Pedagogs: ${data.full_name}`);
  }
  if (f.group) lines.push(`Grupa: ${ref.groups.find((g) => g.id === f.group)?.name ?? ''}`);
  if (f.course) lines.push(`Kurss: ${ref.courses.find((c) => c.id === f.course)?.name ?? ''}`);
  if (f.category) lines.push(`Kategorija: ${ref.categories.find((c) => c.id === f.category)?.name ?? ''}`);
  if (f.product) {
    const { data } = await supabase.from('products').select('name').eq('id', f.product).maybeSingle();
    if (data) lines.push(`Prece: ${data.name}`);
  }
  if (f.topic) lines.push(`Tēma satur: ${f.topic}`);
  lines.push(`Pieteikumu statusi: ${effectiveStatuses(f).map((s) => REQUEST_STATUS_LABEL[s]).join(', ')}`);
  return { periodLabel: period ? periodLabel(period) : f.period ? null : 'visi periodi', lines };
}
