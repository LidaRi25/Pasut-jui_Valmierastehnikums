// Administratora filtru apstrāde: vienota validācija lapām, API un Excel eksportam.
import { ORDER_STATUSES, REQUEST_STATUSES, type RequestStatus } from '@/lib/labels';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface OrderFilters {
  period?: string;
  from?: string;
  to?: string;
  teacher?: string;
  group?: string;
  course?: string;
  product?: string;
  category?: string;
  statuses?: RequestStatus[];
  topic?: string;
}

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

function get(source: Source, key: string): string | undefined {
  if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
  const v = source[key];
  return Array.isArray(v) ? v[0] : v;
}

function getAll(source: Source, key: string): string[] {
  if (source instanceof URLSearchParams) return source.getAll(key);
  const v = source[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

const uuid = (v: string | undefined) => (v && UUID.test(v) ? v : undefined);
const date = (v: string | undefined) => {
  if (!v || !ISO_DATE.test(v)) return undefined;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
};

export function parseOrderFilters(source: Source): OrderFilters {
  const statuses = getAll(source, 'status')
    .flatMap((s) => s.split(','))
    .filter((s): s is RequestStatus => (REQUEST_STATUSES as string[]).includes(s));
  const topic = (get(source, 'topic') ?? '').trim().slice(0, 200);
  return {
    period: uuid(get(source, 'period')),
    from: date(get(source, 'from')),
    to: date(get(source, 'to')),
    teacher: uuid(get(source, 'teacher')),
    group: uuid(get(source, 'group')),
    course: uuid(get(source, 'course')),
    product: uuid(get(source, 'product')),
    category: uuid(get(source, 'category')),
    statuses: statuses.length ? Array.from(new Set(statuses)) : undefined,
    topic: topic || undefined,
  };
}

/** Argumenti RPC funkcijām (order_lines / get_order_summary / get_order_report) */
export function toRpcArgs(f: OrderFilters) {
  return {
    p_period_id: f.period ?? null,
    p_date_from: f.from ?? null,
    p_date_to: f.to ?? null,
    p_teacher_id: f.teacher ?? null,
    p_group_id: f.group ?? null,
    p_course_id: f.course ?? null,
    p_product_id: f.product ?? null,
    p_category_id: f.category ?? null,
    p_statuses: f.statuses ?? null,
    p_topic: f.topic ?? null,
  };
}

export function toQueryString(f: OrderFilters, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  const set = (k: string, v: string | undefined) => {
    if (v) q.set(k, v);
  };
  set('period', f.period);
  set('from', f.from);
  set('to', f.to);
  set('teacher', f.teacher);
  set('group', f.group);
  set('course', f.course);
  set('product', f.product);
  set('category', f.category);
  if (f.statuses?.length) q.set('status', f.statuses.join(','));
  set('topic', f.topic);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function effectiveStatuses(f: OrderFilters): RequestStatus[] {
  return f.statuses?.length ? f.statuses : ORDER_STATUSES;
}
