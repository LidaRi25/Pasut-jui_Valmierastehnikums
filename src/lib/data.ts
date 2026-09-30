import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Category, Course, Group, Period, Unit } from '@/lib/types';
import { formatDate, formatDateTime } from '@/lib/format';
import { numStr } from '@/lib/decimal';

/** Atsauces dati, kas nepieciešami gandrīz katrā lapā (kešoti vienam pieprasījumam). */
export const getReference = cache(async () => {
  const supabase = await createClient();
  const [units, categories, courses, groups, periods] = await Promise.all([
    supabase.from('units').select('id, code, name, is_countable, warn_quantity, sort_order, is_active').order('sort_order'),
    supabase.from('product_categories').select('id, name, sort_order, is_active').order('sort_order').order('name'),
    supabase.from('courses').select('id, name, sort_order, is_active').order('sort_order').order('name'),
    supabase.from('groups').select('id, name, is_active').order('name'),
    supabase
      .from('order_periods')
      .select('id, name, start_date, end_date, submission_deadline, status')
      .order('start_date', { ascending: false })
      .limit(120),
  ]);
  return {
    units: ((units.data ?? []) as Array<Unit & { warn_quantity: string | number | null }>).map((u) => ({ ...u, warn_quantity: numStr(u.warn_quantity) })) as Unit[],
    categories: (categories.data ?? []) as Category[],
    courses: (courses.data ?? []) as Course[],
    groups: (groups.data ?? []) as Group[],
    periods: (periods.data ?? []) as Period[],
  };
});

export type Reference = Awaited<ReturnType<typeof getReference>>;

export const getSettings = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from('app_settings').select('key, value');
  const map: Record<string, unknown> = {};
  for (const row of data ?? []) map[row.key as string] = row.value;
  return {
    institutionName: typeof map.institution_name === 'string' && map.institution_name ? map.institution_name : 'Valmieras tehnikums',
    autosaveSeconds: typeof map.autosave_seconds === 'number' ? map.autosave_seconds : 3,
    printFooter: typeof map.print_footer === 'string' ? map.print_footer : '',
  };
});

/** Atvērtais periods, kuram termiņš vēl nav beidzies (tuvākais termiņš pirmais). */
export function openPeriods(periods: Period[], now = new Date()): Period[] {
  return periods
    .filter((p) => p.status === 'open' && new Date(p.submission_deadline) > now)
    .sort((a, b) => a.submission_deadline.localeCompare(b.submission_deadline));
}

/** "Aktīvais periods" administratora sākumlapai: tuvākais atvērtais, citādi jaunākais neaizvērtais. */
export function pickActivePeriod(periods: Period[], now = new Date()): Period | null {
  const open = openPeriods(periods, now);
  if (open.length) return open[0];
  const notArchived = periods.filter((p) => p.status !== 'archived');
  return notArchived[0] ?? periods[0] ?? null;
}

export function periodLabel(p: Pick<Period, 'name' | 'start_date' | 'end_date'>): string {
  const name = p.name?.trim();
  const range = `${formatDate(p.start_date)}–${formatDate(p.end_date)}`;
  return name && !name.includes(range.slice(0, 6)) ? `${name} (${range})` : name || range;
}

export function periodOptionLabel(p: Period): string {
  return `${periodLabel(p)} · termiņš ${formatDateTime(p.submission_deadline)}`;
}
