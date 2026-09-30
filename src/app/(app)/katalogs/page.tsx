import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { ProductForm, ProposeForm } from '@/components/product-forms';
import { ApprovalBadge, Empty, Flash, PageHeader, Pagination } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getReference } from '@/lib/data';
import { isAdminRole, type ApprovalStatus } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { createProductAction, proposeProductFormAction } from './actions';

export const metadata: Metadata = { title: 'Preču katalogs' };

const PAGE_SIZE = 50;

interface ProductRow {
  id: string;
  name: string;
  category_name: string | null;
  order_unit_code: string;
  base_unit_code: string;
  package_description: string | null;
  is_active: boolean;
  approval_status: ApprovalStatus;
  aliases: string[];
  total_count: number | string;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const admin = isAdminRole(user.role);
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  const category = /^[0-9a-f-]{36}$/i.test(one(sp.category)) ? one(sp.category) : '';
  const status = admin && ['active', 'inactive', 'all'].includes(one(sp.status)) ? one(sp.status) : admin ? 'all' : 'active';
  const approval = admin && ['pending', 'approved', 'rejected'].includes(one(sp.approval)) ? one(sp.approval) : '';
  const page = Math.max(1, Number.parseInt(one(sp.page) || '1', 10) || 1);

  const supabase = await createClient();
  const ref = await getReference();
  const { data } = await supabase.rpc('list_products', {
    p_query: q || null,
    p_category_id: category || null,
    p_status: status,
    p_approval: approval || null,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const rows = (data ?? []) as ProductRow[];
  const total = rows.length ? Number(rows[0].total_count) : 0;

  const params = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (category) u.set('category', category);
    if (admin && status !== 'all') u.set('status', status);
    if (approval) u.set('approval', approval);
    if (p > 1) u.set('page', String(p));
    const s = u.toString();
    return `/katalogs${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <PageHeader
        title="Preču katalogs"
        sub={total ? `${total} ${total === 1 ? 'pozīcija' : 'pozīcijas'}` : undefined}
        actions={
          admin ? (
            <>
              <Link className="btn" href="/katalogs/kategorijas">
                Kategorijas
              </Link>
              <Link className="btn" href="/katalogs/imports">
                <Icon name="upload" size={16} /> Imports (Excel/CSV)
              </Link>
            </>
          ) : null
        }
      />
      <Flash ok={one(sp.ok)} />
      <form method="get" className="card" aria-label="Meklēšana katalogā">
        <div className="filters">
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="cat-q">Meklēt pēc nosaukuma vai sinonīma</label>
            <input id="cat-q" name="q" className="input" defaultValue={q} placeholder="piem., bie, mozarella, sviests…" maxLength={100} type="search" />
          </div>
          <div className="field">
            <label htmlFor="cat-cat">Kategorija</label>
            <select id="cat-cat" name="category" className="select" defaultValue={category}>
              <option value="">Visas kategorijas</option>
              {ref.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {admin ? (
            <>
              <div className="field">
                <label htmlFor="cat-status">Aktivitāte</label>
                <select id="cat-status" name="status" className="select" defaultValue={status}>
                  <option value="all">Visas</option>
                  <option value="active">Aktīvās</option>
                  <option value="inactive">Neaktīvās</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="cat-appr">Apstiprinājums</label>
                <select id="cat-appr" name="approval" className="select" defaultValue={approval}>
                  <option value="">Visas</option>
                  <option value="approved">Apstiprinātās</option>
                  <option value="pending">Neapstiprinātās</option>
                  <option value="rejected">Noraidītās</option>
                </select>
              </div>
            </>
          ) : null}
          <div className="field">
            <button type="submit" className="btn btn-primary">
              <Icon name="search" size={16} /> Meklēt
            </button>
          </div>
        </div>
      </form>

      <div className="table-wrap">
        <table className="table table-stack" aria-label="Preču saraksts">
          <thead>
            <tr>
              <th scope="col">Nosaukums</th>
              <th scope="col">Kategorija</th>
              <th scope="col">Mērv.</th>
              <th scope="col">Iepakojums</th>
              {admin ? <th scope="col">Sinonīmi</th> : null}
              {admin ? <th scope="col">Statuss</th> : null}
              {admin ? (
                <th scope="col" className="actions">
                  Darbības
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={admin ? 7 : 4}>
                  <Empty>Katalogā nekas netika atrasts.</Empty>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Nosaukums" className="primary">
                    {admin ? <Link href={`/katalogs/${r.id}`}>{r.name}</Link> : r.name} <ApprovalBadge status={r.approval_status} />
                  </td>
                  <td data-label="Kategorija">{r.category_name ?? '—'}</td>
                  <td data-label="Mērv.">
                    {r.order_unit_code}
                    {r.base_unit_code !== r.order_unit_code ? <span className="muted small"> (pamatvienība {r.base_unit_code})</span> : null}
                  </td>
                  <td data-label="Iepakojums">{r.package_description ?? ''}</td>
                  {admin ? (
                    <td data-label="Sinonīmi" className="small muted">
                      {r.aliases.join(', ')}
                    </td>
                  ) : null}
                  {admin ? (
                    <td data-label="Statuss">
                      {r.is_active ? <span className="badge badge-green">Aktīva</span> : <span className="badge badge-muted">Neaktīva</span>}
                    </td>
                  ) : null}
                  {admin ? (
                    <td className="actions" data-label="">
                      <Link className="btn btn-sm" href={`/katalogs/${r.id}`}>
                        Labot
                      </Link>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={params} />

      <div style={{ marginTop: '1.25rem' }}>
        {admin ? (
          <details className="inline card" id="jauna-prece">
            <summary>
              <Icon name="plus" size={16} /> Jauna prece katalogā
            </summary>
            <ProductForm action={createProductAction} units={ref.units} categories={ref.categories} submitLabel="Pievienot preci" />
          </details>
        ) : (
          <details className="inline card">
            <summary>
              <Icon name="plus" size={16} /> Ierosināt jaunu preci
            </summary>
            <ProposeForm action={proposeProductFormAction} units={ref.units} categories={ref.categories} />
          </details>
        )}
      </div>
    </>
  );
}
