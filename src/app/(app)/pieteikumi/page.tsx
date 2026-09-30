import type { Metadata } from 'next';
import Link from 'next/link';
import { BULK_FORM_ID, BulkStatusForm, SelectAllCheckbox } from '@/components/bulk-status-form';
import { FilterBar } from '@/components/filter-bar';
import { Icon } from '@/components/icons';
import { Empty, Flash, PageHeader, Pagination, RequestStatusBadge } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getReference, periodLabel } from '@/lib/data';
import { formatDate, formatRequestNo } from '@/lib/format';
import { isAdminRole, REQUEST_STATUS_LABEL, REQUEST_STATUSES, type RequestStatus } from '@/lib/labels';
import { parseOrderFilters, toQueryString } from '@/lib/order-filters';
import { createClient } from '@/lib/supabase/server';
import { copyRequestAction, deleteRequestAction } from './actions';
import { ConfirmAction } from '@/components/confirm-action';

export const metadata: Metadata = { title: 'Pieteikumi' };

const PAGE_SIZE = 25;

interface Row {
  id: string;
  request_no: number;
  topic: string;
  lesson_date: string | null;
  status: RequestStatus;
  updated_at: string;
  teacher_id: string;
  profiles: { full_name: string } | null;
  groups: { name: string } | null;
  courses: { name: string } | null;
  order_periods: { name: string; start_date: string; end_date: string } | null;
  items: Array<{ count: number }>;
}

function escapeIlike(v: string) {
  return v.replace(/[\\%_]/g, (m) => '\\' + m);
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const admin = isAdminRole(user.role);
  const sp = await searchParams;
  const filters = parseOrderFilters(sp);
  const page = Math.max(1, Number.parseInt(String(Array.isArray(sp.page) ? sp.page[0] : sp.page ?? '1'), 10) || 1);
  const supabase = await createClient();
  const reference = await getReference();

  const productFilter = filters.product || filters.category;
  const select =
    'id, request_no, topic, lesson_date, status, updated_at, teacher_id, profiles(full_name), groups(name), courses(name), order_periods(name, start_date, end_date), items:request_items(count)' +
    (productFilter ? ', pf:request_items!inner(product_id, products!inner(category_id))' : '');
  let q = supabase.from('requests').select(select, { count: 'exact' });
  // Pedagogam RLS atgriež savus pieteikumus + to pedagogu pieteikumus, kuriem administrators piešķīris piekļuvi
  if (filters.period) q = q.eq('period_id', filters.period);
  if (filters.from) q = q.gte('lesson_date', filters.from);
  if (filters.to) q = q.lte('lesson_date', filters.to);
  if (admin && filters.teacher) q = q.eq('teacher_id', filters.teacher);
  if (filters.group) q = q.eq('group_id', filters.group);
  if (filters.course) q = q.eq('course_id', filters.course);
  if (filters.statuses?.length) q = q.in('status', filters.statuses);
  if (filters.topic) q = q.ilike('topic', `%${escapeIlike(filters.topic)}%`);
  if (filters.product) q = q.eq('pf.product_id', filters.product);
  if (filters.category) q = q.eq('pf.products.category_id', filters.category);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await q.order('updated_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Row[];
  // "Pedagogs" kolonna: administratoram vienmēr; pedagogam — ja sarakstā ir arī citu pedagogu (piešķirtā piekļuve) pieteikumi
  const showTeacher = admin || rows.some((r) => r.teacher_id !== user.id);

  const teachers = admin
    ? ((await supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')).data ?? [])
    : [];
  let productName: string | undefined;
  if (filters.product) {
    productName = (await supabase.from('products').select('name').eq('id', filters.product).maybeSingle()).data?.name;
  }

  const qs = (p: number) => toQueryString(filters, { page: p > 1 ? String(p) : undefined });
  const hasFilters = Object.values(filters).some((v) => (Array.isArray(v) ? v.length : Boolean(v)));

  const table = (
    <div className="table-wrap">
      <table className="table table-stack" aria-label="Pieteikumu saraksts">
        <thead>
          <tr>
            {admin ? (
              <th scope="col">
                <SelectAllCheckbox />
              </th>
            ) : null}
            <th scope="col">ID</th>
            <th scope="col">Datums</th>
            <th scope="col">Tēma</th>
            {showTeacher ? <th scope="col">Pedagogs</th> : null}
            <th scope="col">Grupa</th>
            <th scope="col">Periods</th>
            <th scope="col" className="num">
              Preces
            </th>
            <th scope="col">Statuss</th>
            <th scope="col" className="actions">
              Darbības
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={(admin ? 1 : 0) + (showTeacher ? 1 : 0) + 8}>
                <Empty>
                  {hasFilters ? 'Neviens pieteikums neatbilst izvēlētajiem filtriem.' : 'Vēl nav neviena pieteikuma.'}
                  {!admin && !hasFilters ? (
                    <>
                      {' '}
                      <Link href="/pieteikumi/jauns">Izveidot pirmo pieteikumu</Link>
                    </>
                  ) : null}
                </Empty>
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                {admin ? (
                  <td data-label="">
                    <input type="checkbox" name="id" value={r.id} form={BULK_FORM_ID} aria-label={`Atzīmēt pieteikumu ${formatRequestNo(r.request_no)}`} />
                  </td>
                ) : null}
                <td data-label="ID" className="nowrap">
                  <Link href={`/pieteikumi/${r.id}`}>{formatRequestNo(r.request_no)}</Link>
                </td>
                <td data-label="Datums" className="nowrap">
                  {formatDate(r.lesson_date) || '—'}
                </td>
                <td data-label="Tēma" className="primary">
                  <Link href={`/pieteikumi/${r.id}`} style={{ color: 'inherit' }}>
                    {r.topic || <span className="muted">(bez tēmas)</span>}
                  </Link>
                </td>
                {showTeacher ? <td data-label="Pedagogs">{r.profiles?.full_name ?? ''}</td> : null}
                <td data-label="Grupa">{[r.courses?.name, r.groups?.name].filter(Boolean).join(', ') || '—'}</td>
                <td data-label="Periods">{r.order_periods ? periodLabel(r.order_periods) : '—'}</td>
                <td data-label="Preces" className="num">
                  {r.items?.[0]?.count ?? 0}
                </td>
                <td data-label="Statuss">
                  <RequestStatusBadge status={r.status} />
                </td>
                <td className="actions" data-label="">
                  <Link className="btn btn-sm" href={`/pieteikumi/${r.id}`}>
                    {r.status === 'draft' ? 'Turpināt' : 'Atvērt'}
                  </Link>{' '}
                  <form action={copyRequestAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="btn btn-sm btn-icon" title="Kopēt pieteikumu" aria-label={`Kopēt pieteikumu ${formatRequestNo(r.request_no)}`}>
                      <Icon name="copy" size={16} />
                    </button>
                  </form>{' '}
                  <a className="btn btn-sm btn-icon" href={`/pieteikumi/${r.id}/druka`} target="_blank" rel="noopener" title="Drukāt" aria-label={`Drukāt pieteikumu ${formatRequestNo(r.request_no)}`}>
                    <Icon name="print" size={16} />
                  </a>
                  {!admin && r.status === 'draft' && r.teacher_id === user.id ? (
                    <>
                      {' '}
                      <ConfirmAction action={deleteRequestAction} label="Dzēst" hidden={{ id: r.id }} question="Dzēst melnrakstu?" />
                    </>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        title={admin ? 'Pieteikumi' : 'Mani pieteikumi'}
        sub={admin ? 'Visi iesniegtie un melnraksta pieteikumi' : 'Jūsu iesniegtie pieteikumi un melnraksti'}
        actions={
          <Link className="btn btn-primary" href="/pieteikumi/jauns">
            <Icon name="plus" size={16} /> Jauns pieteikums
          </Link>
        }
      />
      <Flash ok={typeof sp.ok === 'string' ? sp.ok : undefined} />
      {admin ? (
        <FilterBar action="/pieteikumi" filters={filters} reference={reference} teachers={teachers} productName={productName} />
      ) : (
        <form method="get" className="toolbar" aria-label="Filtri">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="flt-status">Statuss</label>
            <select id="flt-status" name="status" className="select select-sm" defaultValue={filters.statuses?.[0] ?? ''}>
              <option value="">Visi</option>
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="flt-period2">Periods</label>
            <select id="flt-period2" name="period" className="select select-sm" defaultValue={filters.period ?? ''}>
              <option value="">Visi</option>
              {reference.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-sm">
            Filtrēt
          </button>
        </form>
      )}
      {table}
      {admin && rows.length > 0 ? <BulkStatusForm /> : null}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/pieteikumi${qs(p)}`} />
    </>
  );
}
