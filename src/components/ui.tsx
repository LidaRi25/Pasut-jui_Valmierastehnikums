import type { ReactNode } from 'react';
import {
  APPROVAL_LABEL,
  PERIOD_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  periodStatusTone,
  requestStatusTone,
  type ApprovalStatus,
  type PeriodStatus,
  type RequestStatus,
} from '@/lib/labels';

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge badge-${requestStatusTone(status)}`}>{REQUEST_STATUS_LABEL[status]}</span>;
}

export function PeriodStatusBadge({ status }: { status: PeriodStatus }) {
  return <span className={`badge badge-${periodStatusTone(status)}`}>{PERIOD_STATUS_LABEL[status]}</span>;
}

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  if (status === 'approved') return null;
  return <span className={`badge ${status === 'pending' ? 'badge-warn' : 'badge-muted'}`}>{APPROVAL_LABEL[status]}</span>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {actions ? <div className="btn-row">{actions}</div> : null}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

const FLASH: Record<string, { tone: 'success' | 'error' | 'warn'; text: string }> = {
  saved: { tone: 'success', text: 'Izmaiņas saglabātas.' },
  created: { tone: 'success', text: 'Ieraksts izveidots.' },
  deleted: { tone: 'success', text: 'Ieraksts izdzēsts.' },
  submitted: { tone: 'success', text: 'Pieteikums iesniegts.' },
  forbidden: { tone: 'error', text: 'Jums nav tiesību skatīt šo lapu.' },
};

/** Ziņojumi no URL (?ok=saved / ?error=... ) — tikai iepriekš definēti teksti, nekad nerāda patvaļīgu URL saturu */
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  const item = (ok && FLASH[ok]) || (error && FLASH[error]) || null;
  if (!item) return null;
  return <Alert tone={item.tone}>{item.text}</Alert>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Lapošana">
      <span className="muted">
        {from}–{to} no {total}
      </span>
      <span className="btn-row">
        {page > 1 ? (
          <a className="btn btn-sm" href={hrefFor(page - 1)} rel="prev">
            ← Iepriekšējā
          </a>
        ) : null}
        <span className="muted">
          {page}. lpp. no {pages}
        </span>
        {page < pages ? (
          <a className="btn btn-sm" href={hrefFor(page + 1)} rel="next">
            Nākamā →
          </a>
        ) : null}
      </span>
    </nav>
  );
}
