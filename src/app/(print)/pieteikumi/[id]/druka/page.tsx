import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import { requireUser } from '@/lib/auth';
import { getReference, getSettings } from '@/lib/data';
import { formatQuantity } from '@/lib/decimal';
import { formatDate, formatDateTime, formatRequestNo } from '@/lib/format';
import { REQUEST_STATUS_LABEL } from '@/lib/labels';
import { loadRequest } from '@/lib/request-loader';

export const metadata: Metadata = { title: 'Pieteikuma druka' };

export default async function PrintRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const loaded = await loadRequest(id);
  if (!loaded) notFound();
  const { request, teacherName, items } = loaded;
  const [ref, settings] = await Promise.all([getReference(), getSettings()]);
  const course = ref.courses.find((c) => c.id === request.course_id)?.name;
  const group = ref.groups.find((g) => g.id === request.group_id)?.name;
  const courseGroup = [course, group, request.students].filter(Boolean).join(', ');

  return (
    <div className="print-page" id="saturs">
      <div className="print-toolbar">
        <PrintButton />
        <Link className="btn" href={`/pieteikumi/${request.id}`}>
          ← Atpakaļ uz pieteikumu
        </Link>
      </div>
      <article className="sheet" aria-label={`Pieteikums ${formatRequestNo(request.request_no)}`}>
        <div className="sheet-org">{settings.institutionName}</div>
        <div className="meta-grid">
          <div className="k">Mācību kurss / grupa / audzēknis</div>
          <div>{courseGroup || '—'}</div>
          <div className="k">Pasniedzējs</div>
          <div>{teacherName}</div>
          <div className="k">Mācību praktiskās nodarbības tēma</div>
          <div>{request.topic || '—'}</div>
          <div className="k">Datums</div>
          <div>{formatDate(request.lesson_date) || '—'}</div>
          <div className="k">Audzēkņu skaits</div>
          <div>{request.student_count ?? '—'}</div>
        </div>

        <h2 className="list-title">Vajadzīgo produktu saraksts</h2>
        <table>
          <thead>
            <tr>
              <th className="c-no">Npk.</th>
              <th>Prece</th>
              <th className="c-unit">Mērv.</th>
              <th className="c-qty">Daudzums</th>
              <th>Piezīmes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id}>
                <td className="c-no">{i + 1}.</td>
                <td>{it.product.name}</td>
                <td className="c-unit">{it.unit.code}</td>
                <td className="c-qty">{formatQuantity(it.quantity, it.unit.is_countable)}</td>
                <td>{it.notes ?? ''}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center' }}>
                  Pieteikumā nav preču.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {request.notes ? (
          <p style={{ marginTop: '5mm', fontSize: '10pt' }}>
            <strong>Piezīmes:</strong> {request.notes}
          </p>
        ) : null}

        <div className="sign">
          <div>Pasniedzējs (paraksts)</div>
          <div>Pasūtītājs (paraksts)</div>
        </div>
        <div className="foot">
          <span>
            Pieteikums {formatRequestNo(request.request_no)} · {REQUEST_STATUS_LABEL[request.status]}
            {request.submitted_at ? ` · iesniegts ${formatDateTime(request.submitted_at)}` : ''}
          </span>
          <span>{settings.printFooter}</span>
        </div>
      </article>
    </div>
  );
}
