import type { ReactNode } from 'react';
import { formatQuantity } from '@/lib/decimal';
import { formatDate, formatDateTime, formatRequestNo } from '@/lib/format';
import type { RequestItemRow, RequestRow } from '@/lib/types';
import { ApprovalBadge, RequestStatusBadge } from '@/components/ui';

/** Pieteikuma skatījums tikai lasīšanai (kad to vairs nevar labot) */
export function RequestView({
  request,
  teacherName,
  items,
  courseName,
  groupName,
  periodName,
  institutionName,
  actions,
  lockedReason,
}: {
  request: RequestRow;
  teacherName: string;
  items: RequestItemRow[];
  courseName: string | null;
  groupName: string | null;
  periodName: string | null;
  institutionName: string;
  actions?: ReactNode;
  lockedReason?: string;
}) {
  const courseGroup = [courseName, groupName, request.students].filter(Boolean).join(', ');
  return (
    <div className="form-sheet" data-testid="request-view">
      <div className="sheet-title">
        <div className="org">{institutionName}</div>
        <div className="btn-row">
          <span className="muted">Pieteikums {formatRequestNo(request.request_no)}</span>
          <RequestStatusBadge status={request.status} />
        </div>
      </div>
      {lockedReason ? <div className="alert alert-info">{lockedReason}</div> : null}
      <dl className="meta-list">
        <div>
          <dt>Mācību kurss / grupa / audzēknis</dt>
          <dd>{courseGroup || '—'}</dd>
        </div>
        <div>
          <dt>Pasniedzējs</dt>
          <dd>{teacherName}</dd>
        </div>
        <div>
          <dt>Mācību praktiskās nodarbības tēma</dt>
          <dd>{request.topic || '—'}</dd>
        </div>
        <div>
          <dt>Datums</dt>
          <dd>{formatDate(request.lesson_date) || '—'}</dd>
        </div>
        <div>
          <dt>Audzēkņu skaits</dt>
          <dd>{request.student_count ?? '—'}</dd>
        </div>
        <div>
          <dt>Pasūtījuma periods</dt>
          <dd>{periodName ?? '—'}</dd>
        </div>
        {request.notes ? (
          <div>
            <dt>Piezīmes</dt>
            <dd>{request.notes}</dd>
          </div>
        ) : null}
        <div>
          <dt>Izveidots / labots / iesniegts</dt>
          <dd className="small muted">
            {formatDateTime(request.created_at)} / {formatDateTime(request.updated_at)} / {request.submitted_at ? formatDateTime(request.submitted_at) : '—'}
          </dd>
        </div>
      </dl>

      <h2 className="list-heading">Vajadzīgo produktu un materiālu saraksts</h2>
      <div className="table-wrap" style={{ boxShadow: 'none' }}>
        <table className="table table-stack" aria-label="Preču saraksts">
          <thead>
            <tr>
              <th scope="col">Npk.</th>
              <th scope="col">Prece / materiāls</th>
              <th scope="col">Mērv.</th>
              <th scope="col" className="num">
                Daudzums
              </th>
              <th scope="col">Piezīmes</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  Pieteikumā nav preču.
                </td>
              </tr>
            ) : (
              items.map((it, i) => (
                <tr key={it.id}>
                  <td data-label="Npk.">{i + 1}</td>
                  <td data-label="Prece" className="primary">
                    {it.product.name} <ApprovalBadge status={it.product.approval_status} />
                    {it.product.package_description ? <div className="muted small">Iepakojums: {it.product.package_description}</div> : null}
                  </td>
                  <td data-label="Mērv.">{it.unit.code}</td>
                  <td data-label="Daudzums" className="num">
                    <strong>{formatQuantity(it.quantity, it.unit.is_countable)}</strong>
                  </td>
                  <td data-label="Piezīmes">{it.notes ?? ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {actions ? <div className="btn-row" style={{ marginTop: '1rem' }}>{actions}</div> : null}
    </div>
  );
}
