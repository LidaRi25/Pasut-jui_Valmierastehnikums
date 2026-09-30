import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { numStr, toInputValue } from '@/lib/decimal';
import { emptyRow, type FormHeader, type FormItem } from '@/lib/request-form';
import type { RequestItemRow, RequestRow } from '@/lib/types';
import type { PeriodOption } from '@/components/request-editor';
import { periodOptionLabel } from '@/lib/data';
import type { Period } from '@/lib/types';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawItem {
  id: string;
  position: number;
  product_id: string;
  quantity: string | number | null;
  unit_id: string;
  notes: string | null;
  products: {
    id: string;
    name: string;
    package_description: string | null;
    approval_status: 'pending' | 'approved' | 'rejected';
    is_active: boolean;
    order_unit_id: string;
    units: { id: string; code: string } | null;
  } | null;
  units: { id: string; code: string; is_countable: boolean; warn_quantity: string | number | null } | null;
}

export interface LoadedRequest {
  request: RequestRow;
  teacherName: string;
  items: RequestItemRow[];
  formItems: FormItem[];
}

export async function loadRequest(id: string): Promise<LoadedRequest | null> {
  if (!UUID_RE.test(id)) return null;
  const supabase = await createClient();
  const { data: req } = await supabase
    .from('requests')
    .select(
      'id, request_no, teacher_id, period_id, course_id, group_id, students, topic, lesson_date, student_count, notes, status, created_at, updated_at, submitted_at, profiles(full_name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!req) return null;
  const { data: rawItems } = await supabase
    .from('request_items')
    .select(
      'id, position, product_id, quantity, unit_id, notes, products(id, name, package_description, approval_status, is_active, order_unit_id, units!products_order_unit_id_fkey(id, code)), units(id, code, is_countable, warn_quantity)',
    )
    .eq('request_id', id)
    .order('position');
  const raw = (rawItems ?? []) as unknown as RawItem[];

  const items: RequestItemRow[] = raw.map((r) => ({
    id: r.id,
    position: r.position,
    product_id: r.product_id,
    quantity: numStr(r.quantity),
    unit_id: r.unit_id,
    notes: r.notes,
    product: {
      id: r.products?.id ?? r.product_id,
      name: r.products?.name ?? '(prece nav pieejama)',
      package_description: r.products?.package_description ?? null,
      approval_status: r.products?.approval_status ?? 'approved',
      is_active: r.products?.is_active ?? false,
    },
    unit: {
      id: r.units?.id ?? r.unit_id,
      code: r.units?.code ?? '',
      is_countable: r.units?.is_countable ?? false,
      warn_quantity: numStr(r.units?.warn_quantity),
    },
  }));

  const formItems: FormItem[] = raw.map((r) => ({
    ...emptyRow(r.id),
    productId: r.product_id,
    productName: r.products?.name ?? '',
    query: r.products?.name ?? '',
    unitId: r.unit_id,
    unitCode: r.units?.code ?? '',
    unitCountable: r.units?.is_countable ?? false,
    unitWarn: numStr(r.units?.warn_quantity),
    defaultUnitId: r.products?.order_unit_id ?? r.unit_id,
    defaultUnitCode: r.products?.units?.code ?? r.units?.code ?? '',
    packageDescription: r.products?.package_description ?? null,
    approval: r.products?.approval_status ?? 'approved',
    quantity: toInputValue(r.quantity),
    notes: r.notes ?? '',
  }));

  const { profiles, ...requestRow } = req as unknown as RequestRow & { profiles: { full_name: string } | null };
  return { request: requestRow, teacherName: profiles?.full_name ?? '', items, formItems };
}

export function headerFromRequest(r: RequestRow): FormHeader {
  return {
    periodId: r.period_id ?? '',
    courseId: r.course_id ?? '',
    groupId: r.group_id ?? '',
    students: r.students ?? '',
    topic: r.topic ?? '',
    lessonDate: r.lesson_date ?? '',
    studentCount: r.student_count === null ? '' : String(r.student_count),
    notes: r.notes ?? '',
  };
}

/** Perioda izvēles saraksts redaktoram: atvērti periodi, kuriem termiņš nav beidzies (administratoram — visi neArhivētie) + pieteikuma pašreizējais periods. */
export function buildPeriodOptions(periods: Period[], currentId: string | null, isAdmin: boolean, now = new Date()): PeriodOption[] {
  return periods
    .filter((p) => {
      const selectable = p.status === 'open' && new Date(p.submission_deadline) > now;
      return selectable || p.id === currentId || (isAdmin && p.status !== 'archived');
    })
    .map((p) => ({
      id: p.id,
      label: periodOptionLabel(p),
      start: p.start_date,
      end: p.end_date,
      deadline: p.submission_deadline,
      selectable: isAdmin ? true : p.status === 'open' && new Date(p.submission_deadline) > now,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}
