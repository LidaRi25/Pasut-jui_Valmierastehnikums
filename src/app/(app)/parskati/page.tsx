import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterBar } from '@/components/filter-bar';
import { Icon } from '@/components/icons';
import { Empty, PageHeader } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getReference, pickActivePeriod } from '@/lib/data';
import { formatQuantity } from '@/lib/decimal';
import { ORDER_STATUSES } from '@/lib/labels';
import { loadReport, type Dimension } from '@/lib/order-data';
import { parseOrderFilters, toQueryString } from '@/lib/order-filters';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Pārskati' };

const DIMENSIONS: Array<{ key: Dimension; label: string; header: string }> = [
  { key: 'teacher', label: 'Pa pedagogiem', header: 'Pedagogs' },
  { key: 'group', label: 'Pa grupām', header: 'Grupa' },
  { key: 'course', label: 'Pa kursiem', header: 'Kurss' },
  { key: 'date', label: 'Pa datumiem', header: 'Datums' },
  { key: 'category', label: 'Pa kategorijām', header: 'Kategorija' },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = parseOrderFilters(sp);
  const reference = await getReference();
  if (sp.period === undefined) {
    const active = pickActivePeriod(reference.periods);
    if (active) filters.period = active.id;
  }
  const dimParam = Array.isArray(sp.dim) ? sp.dim[0] : sp.dim;
  const dim = DIMENSIONS.find((d) => d.key === dimParam) ?? DIMENSIONS[0];
  const supabase = await createClient();
  const [rows, teachers] = await Promise.all([
    loadReport(supabase, dim.key, filters),
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
  ]);
  const countable = new Set(reference.units.filter((u) => u.is_countable).map((u) => u.code));
  const base = toQueryString(filters);
  const tabHref = (key: string) => `/parskati${base}${base ? '&' : '?'}dim=${key}`;

  const groups = new Map<string, { label: string; rows: typeof rows }>();
  for (const r of rows) {
    const g = groups.get(r.group_key) ?? { label: r.group_label, rows: [] };
    g.rows.push(r);
    groups.set(r.group_key, g);
  }

  return (
    <>
      <PageHeader
        title="Pārskati"
        sub="Pasūtījums pa pedagogiem, grupām, kursiem, datumiem un kategorijām"
        actions={
          <>
            <Link className="btn" href="/parskati/audits">
              Audita vēsture
            </Link>
            <a className="btn btn-primary" href={`/api/export/order${base}`}>
              <Icon name="download" size={16} /> Eksportēt Excel
            </a>
          </>
        }
      />
      <FilterBar action="/parskati" filters={filters} reference={reference} teachers={teachers.data ?? []} defaultStatuses={ORDER_STATUSES} hidden={{ dim: dim.key }} />
      <nav aria-label="Pārskata griezums" className="btn-row" style={{ marginBottom: '0.75rem' }}>
        {DIMENSIONS.map((d) => (
          <Link key={d.key} className={`btn btn-sm ${d.key === dim.key ? 'btn-dark' : ''}`} href={tabHref(d.key)} aria-current={d.key === dim.key ? 'page' : undefined}>
            {d.label}
          </Link>
        ))}
      </nav>
      <div className="table-wrap">
        <table className="table" aria-label={`Pārskats ${dim.label.toLowerCase()}`}>
          <thead>
            <tr>
              <th scope="col">{dim.header}</th>
              <th scope="col">Prece</th>
              <th scope="col">Kategorija</th>
              <th scope="col">Mērv.</th>
              <th scope="col" className="num">
                Daudzums
              </th>
              <th scope="col" className="num">
                Pieteikumi
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty>Izvēlētajiem filtriem nav datu.</Empty>
                </td>
              </tr>
            ) : (
              [...groups.entries()].flatMap(([key, g]) =>
                g.rows.map((r, i) => (
                  <tr key={`${key}-${r.product_id}-${r.unit_id}`}>
                    <td className="primary">{i === 0 ? g.label : ''}</td>
                    <td>{r.product_name}</td>
                    <td>{r.category_name ?? '—'}</td>
                    <td>{r.unit_code}</td>
                    <td className="num total">{formatQuantity(r.total_quantity, countable.has(r.unit_code))}</td>
                    <td className="num">{r.request_count}</td>
                  </tr>
                )),
              )
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
