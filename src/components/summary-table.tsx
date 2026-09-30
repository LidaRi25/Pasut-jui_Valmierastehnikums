'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { formatQuantity } from '@/lib/decimal';
import { formatDate, formatRequestNo } from '@/lib/format';
import { REQUEST_STATUS_LABEL, type RequestStatus } from '@/lib/labels';
import type { OrderLine, SummaryRow } from '@/lib/types';

type Row = SummaryRow & { countable: boolean };

/**
 * Kopējā pasūtījuma tabula. Nospiežot "Detalizēti", tiek parādīti sākotnējie pieteikumi,
 * no kuriem izveidojusies kopsumma (ielādē /api/order/lines ar tiem pašiem filtriem).
 */
export function SummaryTable({ rows, query }: { rows: Row[]; query: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, OrderLine[] | 'loading' | 'error'>>({});
  const keyOf = (r: Row) => `${r.product_id}|${r.unit_id}`;

  const toggle = (r: Row) => {
    const key = keyOf(r);
    if (open === key) {
      setOpen(null);
      return;
    }
    setOpen(key);
    if (lines[key] && lines[key] !== 'error') return;
    setLines((l) => ({ ...l, [key]: 'loading' }));
    const q = new URLSearchParams(query.replace(/^\?/, ''));
    q.set('product', r.product_id);
    q.set('unit', r.unit_id);
    fetch(`/api/order/lines?${q.toString()}`, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { lines: OrderLine[] };
      })
      .then((json) => setLines((l) => ({ ...l, [key]: json.lines })))
      .catch(() => setLines((l) => ({ ...l, [key]: 'error' })));
  };

  return (
    <div className="table-wrap">
      <table className="table" aria-label="Kopējais pasūtījums">
        <thead>
          <tr>
            <th scope="col">Prece</th>
            <th scope="col">Kategorija</th>
            <th scope="col" className="num">
              Kopējais daudzums
            </th>
            <th scope="col">Mērv.</th>
            <th scope="col" className="num">
              Pieteikumu skaits
            </th>
            <th scope="col" className="num">
              Pedagogu skaits
            </th>
            <th scope="col">Grupas</th>
            <th scope="col" className="actions">
              Darbības
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="empty">
                Izvēlētajiem filtriem nav neviena pieteikuma ar precēm.
              </td>
            </tr>
          ) : null}
          {rows.map((r) => {
            const key = keyOf(r);
            const isOpen = open === key;
            const detail = lines[key];
            return (
              <Fragment key={key}>
                <tr data-testid="summary-row" className={r.approval_status !== 'approved' ? 'row-warn' : undefined}>
                  <td className="primary">
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, minHeight: 0, fontWeight: 700, textAlign: 'left' }} aria-expanded={isOpen} onClick={() => toggle(r)}>
                      {r.product_name}
                    </button>{' '}
                    {r.approval_status === 'pending' ? <span className="badge badge-warn">Neapstiprināta</span> : null}
                    {r.approval_status === 'rejected' ? <span className="badge badge-warn">Noraidīta</span> : null}
                    {!r.product_active && r.approval_status === 'approved' ? <span className="badge badge-muted">Neaktīva</span> : null}
                  </td>
                  <td>{r.category_name ?? '—'}</td>
                  <td className="num total" data-testid="total-qty">
                    {formatQuantity(r.total_quantity, r.countable)}
                    {r.equivalent_quantity !== null && r.equivalent_unit_code ? (
                      <div className="muted small" style={{ fontWeight: 400 }}>
                        ≈ {formatQuantity(r.equivalent_quantity)} {r.equivalent_unit_code}
                      </div>
                    ) : null}
                  </td>
                  <td>{r.unit_code}</td>
                  <td className="num">{r.request_count}</td>
                  <td className="num">{r.teacher_count}</td>
                  <td className="small">{r.group_names ?? '—'}</td>
                  <td className="actions">
                    <button type="button" className="btn btn-sm" aria-expanded={isOpen} onClick={() => toggle(r)}>
                      {isOpen ? 'Aizvērt' : 'Detalizēti'}
                    </button>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="subrow" data-testid="detail-row">
                    <td colSpan={8}>
                      {detail === 'loading' || detail === undefined ? <span className="muted">Ielādē…</span> : null}
                      {detail === 'error' ? <span className="field-error">Detalizāciju neizdevās ielādēt.</span> : null}
                      {Array.isArray(detail) ? (
                        <div>
                          <strong>
                            {r.product_name}: {formatQuantity(r.total_quantity, r.countable)} {r.unit_code} = {detail.length} pieteikuma {detail.length === 1 ? 'rinda' : 'rindas'}
                          </strong>
                          <table className="table" style={{ background: 'transparent', marginTop: '0.4rem' }} aria-label={`Detalizācija: ${r.product_name}`}>
                            <thead>
                              <tr>
                                <th scope="col">Pedagogs</th>
                                <th scope="col">Kurss / grupa</th>
                                <th scope="col">Datums</th>
                                <th scope="col">Tēma</th>
                                <th scope="col" className="num">
                                  Daudzums
                                </th>
                                <th scope="col">Pieteikums</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.map((l) => (
                                <tr key={l.item_id}>
                                  <td>{l.teacher_name}</td>
                                  <td>{[l.course_name, l.group_name].filter(Boolean).join(', ') || '—'}</td>
                                  <td className="nowrap">{formatDate(l.lesson_date)}</td>
                                  <td>{l.topic}</td>
                                  <td className="num">
                                    <strong>
                                      {formatQuantity(l.quantity, r.countable)} {l.unit_code}
                                    </strong>
                                  </td>
                                  <td className="nowrap">
                                    <Link href={`/pieteikumi/${l.request_id}`}>{formatRequestNo(l.request_no)}</Link>{' '}
                                    <span className="muted small">{REQUEST_STATUS_LABEL[l.request_status as RequestStatus]}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
