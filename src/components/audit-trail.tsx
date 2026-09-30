import { createClient } from '@/lib/supabase/server';
import { describeAudit, type AuditRow } from '@/lib/audit';
import { formatDateTime } from '@/lib/format';

/** Izmaiņu vēsture konkrētam ierakstam (tikai administratoriem; RLS citiem neatgriež neko) */
export async function AuditTrail({ entityType, entityId, limit = 30 }: { entityType: string; entityId: string; limit?: number }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_log')
    .select('id, created_at, actor_name, action, entity_type, entity_id, details')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('id', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as AuditRow[];
  if (rows.length === 0) return <p className="muted">Vēl nav reģistrētu izmaiņu.</p>;
  return (
    <ul className="timeline" aria-label="Izmaiņu vēsture">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="muted nowrap">{formatDateTime(r.created_at)}</span> · <strong>{r.actor_name ?? 'Sistēma'}</strong> — {describeAudit(r)}
        </li>
      ))}
    </ul>
  );
}
