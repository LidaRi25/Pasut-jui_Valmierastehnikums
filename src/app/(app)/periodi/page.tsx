import type { Metadata } from 'next';
import Link from 'next/link';
import { PeriodForm } from '@/components/period-form';
import { Empty, PageHeader, PeriodStatusBadge } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getReference } from '@/lib/data';
import { formatDate, formatDateTime, timeLeft, toDateTimeLocal } from '@/lib/format';
import { savePeriodAction } from './actions';

export const metadata: Metadata = { title: 'Periodi' };

export default async function PeriodsPage() {
  await requireAdmin();
  const ref = await getReference();
  return (
    <>
      <PageHeader title="Pasūtījuma periodi" sub="Periods nosaka, kuriem datumiem pedagogi var iesniegt pieteikumus un līdz kuram brīdim." />
      <section className="card section-accent">
        <div className="card-title">
          <h2>Jauns periods</h2>
        </div>
        <PeriodForm action={savePeriodAction} submitLabel="Izveidot periodu" />
      </section>

      <div className="table-wrap">
        <table className="table table-stack" aria-label="Periodi">
          <thead>
            <tr>
              <th scope="col">Periods</th>
              <th scope="col">Datumi</th>
              <th scope="col">Iesniegšanas termiņš</th>
              <th scope="col">Statuss</th>
              <th scope="col" className="actions">
                Darbības
              </th>
            </tr>
          </thead>
          <tbody>
            {ref.periods.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <Empty>Vēl nav izveidots neviens periods.</Empty>
                </td>
              </tr>
            ) : (
              ref.periods.map((p) => (
                <tr key={p.id}>
                  <td data-label="Periods" className="primary">
                    {p.name}
                  </td>
                  <td data-label="Datumi" className="nowrap">
                    {formatDate(p.start_date)}–{formatDate(p.end_date)}
                  </td>
                  <td data-label="Termiņš">
                    {formatDateTime(p.submission_deadline)}{' '}
                    {p.status === 'open' ? <span className="muted small">({timeLeft(p.submission_deadline)})</span> : null}
                  </td>
                  <td data-label="Statuss">
                    <PeriodStatusBadge status={p.status} />
                  </td>
                  <td className="actions" data-label="">
                    <Link className="btn btn-sm" href={`/pasutijums?period=${p.id}`}>
                      Kopējais pasūtījums
                    </Link>{' '}
                    <Link className="btn btn-sm" href={`/pieteikumi?period=${p.id}`}>
                      Pieteikumi
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {ref.periods.length > 0 ? (
        <section className="card" style={{ marginTop: '1rem' }}>
          <div className="card-title">
            <h2>Labot periodus</h2>
          </div>
          {ref.periods.map((p) => (
            <details className="inline" key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '0.6rem 0' }}>
              <summary>
                {p.name} <PeriodStatusBadge status={p.status} />
              </summary>
              <PeriodForm
                action={savePeriodAction}
                submitLabel="Saglabāt"
                defaults={{ id: p.id, name: p.name, start_date: p.start_date, end_date: p.end_date, deadline: toDateTimeLocal(p.submission_deadline), status: p.status }}
              />
            </details>
          ))}
        </section>
      ) : null}
    </>
  );
}
