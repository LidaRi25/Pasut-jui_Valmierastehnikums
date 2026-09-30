import type { Metadata } from 'next';
import Link from 'next/link';
import { ProposalForm } from '@/components/proposal-form';
import { Alert, Empty, PageHeader } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getReference } from '@/lib/data';
import { formatDateTime, formatRequestNo } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { resolveProposalAction } from './actions';

export const metadata: Metadata = { title: 'Jaunās preces' };

interface Proposal {
  id: string;
  product_id: string;
  proposed_name: string;
  unit_id: string;
  category_id: string | null;
  notes: string | null;
  created_at: string;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  proposer: { full_name: string } | null;
  resolver: { full_name: string } | null;
  units: { code: string } | null;
}

const STATUS_LABEL: Record<string, string> = { approved: 'Apstiprināta', merged: 'Apvienota (sinonīms)', rejected: 'Noraidīta', pending: 'Gaida' };

const DONE_MESSAGE: Record<string, string> = {
  approve: 'Prece apstiprināta un pievienota katalogam.',
  merge: 'Prece pievienota kā sinonīms esošai precei; pieteikumu rindas pārceltas uz pareizo preci.',
  reject: 'Ierosinājums noraidīts.',
};

export default async function NewProductsPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await requireAdmin();
  const { done } = await searchParams;
  const supabase = await createClient();
  const ref = await getReference();
  const select =
    'id, product_id, proposed_name, unit_id, category_id, notes, created_at, status, resolution_note, resolved_at, proposer:profiles!product_proposals_proposed_by_fkey(full_name), resolver:profiles!product_proposals_resolved_by_fkey(full_name), units(code)';
  const [{ data: pending }, { data: resolved }] = await Promise.all([
    supabase.from('product_proposals').select(select).eq('status', 'pending').order('created_at'),
    supabase.from('product_proposals').select(select).neq('status', 'pending').order('resolved_at', { ascending: false }).limit(15),
  ]);
  const pend = (pending ?? []) as unknown as Proposal[];

  // Kuros pieteikumos jaunās preces jau tiek izmantotas
  const usage = new Map<string, Array<{ id: string; request_no: number; topic: string }>>();
  if (pend.length) {
    const { data: items } = await supabase
      .from('request_items')
      .select('product_id, requests(id, request_no, topic)')
      .in('product_id', pend.map((p) => p.product_id));
    for (const it of (items ?? []) as unknown as Array<{ product_id: string; requests: { id: string; request_no: number; topic: string } | null }>) {
      if (!it.requests) continue;
      const list = usage.get(it.product_id) ?? [];
      if (!list.some((r) => r.id === it.requests!.id)) list.push(it.requests);
      usage.set(it.product_id, list);
    }
  }

  return (
    <>
      <PageHeader title="Jaunās / neapstiprinātās preces" sub="Pedagogu ierosinātās preces, kas vēl nav apstiprinātas katalogā." />
      {done && DONE_MESSAGE[done] ? <Alert tone="success">{DONE_MESSAGE[done]}</Alert> : null}
      {pend.length === 0 ? (
        <div className="card">
          <Empty>Nav jaunu preču, kas gaida apstiprinājumu.</Empty>
        </div>
      ) : (
        pend.map((p) => (
          <section className="card" key={p.id} aria-label={`Ierosinājums: ${p.proposed_name}`} data-testid="proposal-card">
            <div className="card-title">
              <h2>{p.proposed_name}</h2>
              <span className="muted small">
                Ierosināja {p.proposer?.full_name ?? '—'} · {formatDateTime(p.created_at)} · mērvienība {p.units?.code}
              </span>
            </div>
            {p.notes ? <p>Piezīme: {p.notes}</p> : null}
            <p className="small">
              Izmantota pieteikumos:{' '}
              {(usage.get(p.product_id) ?? []).length === 0
                ? '—'
                : (usage.get(p.product_id) ?? []).map((r, i) => (
                    <span key={r.id}>
                      {i > 0 ? ', ' : ''}
                      <Link href={`/pieteikumi/${r.id}`}>
                        {formatRequestNo(r.request_no)} {r.topic ? `(${r.topic})` : ''}
                      </Link>
                    </span>
                  ))}
            </p>
            <ProposalForm action={resolveProposalAction} proposalId={p.id} name={p.proposed_name} categoryId={p.category_id} unitId={p.unit_id} units={ref.units} categories={ref.categories} />
          </section>
        ))
      )}

      <section className="card" aria-labelledby="h-done">
        <div className="card-title">
          <h2 id="h-done">Nesen izskatītie</h2>
        </div>
        {(resolved ?? []).length === 0 ? (
          <Empty>Vēl nav izskatītu ierosinājumu.</Empty>
        ) : (
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table className="table table-stack" aria-label="Izskatītie ierosinājumi">
              <thead>
                <tr>
                  <th scope="col">Prece</th>
                  <th scope="col">Ierosināja</th>
                  <th scope="col">Lēmums</th>
                  <th scope="col">Izskatīja</th>
                  <th scope="col">Piezīme</th>
                </tr>
              </thead>
              <tbody>
                {((resolved ?? []) as unknown as Proposal[]).map((p) => (
                  <tr key={p.id}>
                    <td data-label="Prece" className="primary">
                      {p.proposed_name}
                    </td>
                    <td data-label="Ierosināja">{p.proposer?.full_name}</td>
                    <td data-label="Lēmums">{STATUS_LABEL[p.status] ?? p.status}</td>
                    <td data-label="Izskatīja">
                      {p.resolver?.full_name} <span className="muted small">{formatDateTime(p.resolved_at)}</span>
                    </td>
                    <td data-label="Piezīme">{p.resolution_note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
