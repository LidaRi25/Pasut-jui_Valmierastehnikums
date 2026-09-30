import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHeader, Pagination } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { describeAudit, ENTITY_LABEL, type AuditRow } from '@/lib/audit';
import { formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Audita vēsture' };
const PAGE_SIZE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const entity = Object.keys(ENTITY_LABEL).includes(one(sp.entity)) ? one(sp.entity) : '';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.from)) ? one(sp.from) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.to)) ? one(sp.to) : '';
  const page = Math.max(1, Number.parseInt(one(sp.page) || '1', 10) || 1);
  const supabase = await createClient();
  let q = supabase.from('audit_log').select('id, created_at, actor_name, action, entity_type, entity_id, details', { count: 'exact' });
  if (entity) q = q.eq('entity_type', entity);
  if (from) q = q.gte('created_at', `${from}T00:00:00+03:00`);
  if (to) q = q.lt('created_at', `${to}T23:59:59+02:00`);
  const start = (page - 1) * PAGE_SIZE;
  const { data, count } = await q.order('id', { ascending: false }).range(start, start + PAGE_SIZE - 1);
  const rows = (data ?? []) as AuditRow[];
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (entity) u.set('entity', entity);
    if (from) u.set('from', from);
    if (to) u.set('to', to);
    if (p > 1) u.set('page', String(p));
    const s = u.toString();
    return `/parskati/audits${s ? `?${s}` : ''}`;
  };
  return (
    <>
      <PageHeader
        title="Audita vēsture"
        sub="Kas, kad un ko mainījis. Ierakstus nevar labot vai dzēst."
        actions={
          <Link className="btn" href="/parskati">
            ← Uz pārskatiem
          </Link>
        }
      />
      <form method="get" className="card" aria-label="Audita filtri">
        <div className="filters">
          <div className="field">
            <label htmlFor="au-entity">Objekts</label>
            <select id="au-entity" name="entity" className="select" defaultValue={entity}>
              <option value="">Visi</option>
              {Object.entries(ENTITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="au-from">No datuma</label>
            <input id="au-from" name="from" type="date" className="input" defaultValue={from} />
          </div>
          <div className="field">
            <label htmlFor="au-to">Līdz datumam</label>
            <input id="au-to" name="to" type="date" className="input" defaultValue={to} />
          </div>
          <div className="field">
            <button className="btn btn-primary" type="submit">
              Filtrēt
            </button>
          </div>
        </div>
      </form>
      <div className="table-wrap">
        <table className="table table-stack" aria-label="Audita vēsture">
          <thead>
            <tr>
              <th scope="col">Laiks</th>
              <th scope="col">Lietotājs</th>
              <th scope="col">Objekts</th>
              <th scope="col">Darbība</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <Empty>Nav ierakstu.</Empty>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Laiks" className="nowrap">
                    {formatDateTime(r.created_at)}
                  </td>
                  <td data-label="Lietotājs">{r.actor_name ?? 'Sistēma'}</td>
                  <td data-label="Objekts">
                    {r.entity_type === 'requests' && r.entity_id ? <Link href={`/pieteikumi/${r.entity_id}`}>{ENTITY_LABEL[r.entity_type]}</Link> : r.entity_type === 'products' && r.entity_id ? <Link href={`/katalogs/${r.entity_id}`}>{ENTITY_LABEL[r.entity_type]}</Link> : (ENTITY_LABEL[r.entity_type] ?? r.entity_type)}
                  </td>
                  <td data-label="Darbība">{describeAudit(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={qs} />
    </>
  );
}
