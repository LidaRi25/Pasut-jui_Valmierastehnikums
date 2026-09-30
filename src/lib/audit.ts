// Audita ierakstu attēlošana latviešu valodā
import { REQUEST_STATUS_LABEL, PERIOD_STATUS_LABEL, ROLE_LABEL, type AppRole, type PeriodStatus, type RequestStatus } from '@/lib/labels';
import { formatQuantity } from '@/lib/decimal';

export interface AuditRow {
  id: number;
  created_at: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
}

export const ENTITY_LABEL: Record<string, string> = {
  requests: 'Pieteikums',
  products: 'Prece',
  product_aliases: 'Preces sinonīms',
  product_proposals: 'Jaunas preces ierosinājums',
  order_periods: 'Periods',
  user_roles: 'Lietotāja loma',
  profiles: 'Lietotājs',
  groups: 'Grupa',
  courses: 'Kurss',
  product_categories: 'Kategorija',
  units: 'Mērvienība',
  teacher_access_grants: 'Papildu piekļuve',
  app_settings: 'Iestatījums',
};

const FIELD_LABEL: Record<string, string> = {
  name: 'nosaukums',
  category_id: 'kategorija',
  base_unit_id: 'pamatmērvienība',
  order_unit_id: 'pasūtīšanas mērvienība',
  package_description: 'iepakojums',
  package_quantity: 'daudzums iepakojumā',
  barcode: 'svītrkods',
  notes: 'piezīmes',
  is_active: 'aktīvs',
  approval_status: 'apstiprinājums',
  merged_into: 'apvienots ar citu preci',
  approved_by: 'apstiprināja',
  approved_at: 'apstiprināts',
  created_by: 'izveidoja',
  full_name: 'vārds',
  email: 'e-pasts',
  role: 'loma',
  status: 'statuss',
  start_date: 'sākuma datums',
  end_date: 'beigu datums',
  submission_deadline: 'iesniegšanas termiņš',
  topic: 'tēma',
  lesson_date: 'datums',
  student_count: 'audzēkņu skaits',
  students: 'audzēkņi',
  period_id: 'periods',
  group_id: 'grupa',
  course_id: 'kurss',
  code: 'kods',
  warn_quantity: 'brīdinājuma slieksnis',
  is_countable: 'skaitāma vienība',
  sort_order: 'kārtība',
  value: 'vērtība',
  can_edit: 'drīkst labot',
  resolution_note: 'piezīme lēmumam',
  proposed_name: 'ierosinātais nosaukums',
  alias: 'sinonīms',
  product_id: 'prece',
};

const APPROVAL: Record<string, string> = { pending: 'neapstiprināta', approved: 'apstiprināta', rejected: 'noraidīta' };
const PROPOSAL: Record<string, string> = { pending: 'gaida', approved: 'apstiprināts', merged: 'apvienots', rejected: 'noraidīts' };

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'jā' : 'nē';
  if (field === 'role') return ROLE_LABEL[v as AppRole] ?? String(v);
  if (field === 'approval_status') return APPROVAL[String(v)] ?? String(v);
  if (field === 'status') {
    const s = String(v);
    return REQUEST_STATUS_LABEL[s as RequestStatus] ?? PERIOD_STATUS_LABEL[s as PeriodStatus] ?? PROPOSAL[s] ?? s;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  const text = String(v);
  return text.length > 60 ? text.slice(0, 57) + '…' : text;
}

export function describeAudit(r: AuditRow): string {
  const d = r.details ?? {};
  const label = (d.label as string | undefined) ?? '';
  const entity = ENTITY_LABEL[r.entity_type] ?? r.entity_type;
  switch (r.action) {
    case 'status_change': {
      const from = REQUEST_STATUS_LABEL[d.from as RequestStatus] ?? String(d.from);
      const to = REQUEST_STATUS_LABEL[d.to as RequestStatus] ?? String(d.to);
      return `pieteikuma statuss mainīts: ${from} → ${to}${d.to === 'submitted' ? ' (iesniegts)' : ''}`;
    }
    case 'item_insert':
      return `pievienota rinda «${d.product}» — ${formatQuantity(d.quantity as string)} ${d.unit ?? ''}`;
    case 'item_delete':
      return `dzēsta rinda «${d.product}» — ${formatQuantity(d.quantity as string)} ${d.unit ?? ''}`;
    case 'item_update': {
      const q = d.quantity as { old?: string; new?: string } | string | undefined;
      const qty = q && typeof q === 'object' ? `${formatQuantity(q.old)} → ${formatQuantity(q.new)}` : formatQuantity(q as string);
      return d.old_product_id ? `rinda pārcelta uz preci «${d.product}» (apvienojot produktus), daudzums ${qty} ${d.unit ?? ''}` : `mainīta rinda «${d.product}»: daudzums ${qty} ${d.unit ?? ''}`;
    }
    case 'insert':
      return `izveidots (${entity.toLowerCase()}${label ? ` «${label}»` : ''})`;
    case 'delete':
      return `dzēsts (${entity.toLowerCase()}${label ? ` «${label}»` : ''})`;
    case 'update': {
      const changes = (d.changes ?? {}) as Record<string, { old: unknown; new: unknown }>;
      const parts = Object.entries(changes)
        .filter(([k]) => !['approved_at', 'submitted_at', 'resolved_at'].includes(k))
        .map(([k, v]) => `${FIELD_LABEL[k] ?? k}: ${show(k, v.old)} → ${show(k, v.new)}`);
      return `${entity.toLowerCase()}${label ? ` «${label}»` : ''} mainīts — ${parts.join('; ') || 'izmaiņas'}`;
    }
    default:
      return `${r.action} (${entity})`;
  }
}
