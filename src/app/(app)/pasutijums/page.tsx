import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmAction } from '@/components/confirm-action';
import { FilterBar } from '@/components/filter-bar';
import { Icon } from '@/components/icons';
import { SummaryTable } from '@/components/summary-table';
import { Alert, Flash, PageHeader, PeriodStatusBadge } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getReference, periodLabel, pickActivePeriod } from '@/lib/data';
import { formatDateTime } from '@/lib/format';
import { ORDER_STATUSES } from '@/lib/labels';
import { loadSummary } from '@/lib/order-data';
import { parseOrderFilters, toQueryString } from '@/lib/order-filters';
import { createClient } from '@/lib/supabase/server';
import { periodWorkflowAction } from '../periodi/actions';

export const metadata: Metadata = { title: 'Kopējais pasūtījums' };

export default async function OrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = parseOrderFilters(sp);
  const supabase = await createClient();
  const reference = await getReference();
  // Ja periods nav norādīts vispār — ņemam aktīvo periodu (skaidra izvēle "Visi periodi" atstāj period=)
  if (sp.period === undefined) {
    const active = pickActivePeriod(reference.periods);
    if (active) filters.period = active.id;
  }
  const period = filters.period ? reference.periods.find((p) => p.id === filters.period) : undefined;

  const [summaryRaw, teachersRes, productRes] = await Promise.all([
    loadSummary(supabase, filters),
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
    filters.product ? supabase.from('products').select('name').eq('id', filters.product).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const countable = new Set(reference.units.filter((u) => u.is_countable).map((u) => u.id));
  const rows = summaryRaw.map((r) => ({ ...r, countable: countable.has(r.unit_id) }));
  const unapproved = rows.filter((r) => r.approval_status !== 'approved').length;
  const query = toQueryString(filters);
  const exportHref = `/api/export/order${query}`;
  // Perioda darbplūsmas darbībām atgriežamies uz šo pašu skatu
  const back = `/pasutijums${query}`;

  return (
    <>
      <PageHeader
        title="Kopējais pasūtījums"
        sub={period ? periodLabel(period) : filters.period ? undefined : 'Visi periodi'}
        actions={
          <a className="btn btn-primary" href={exportHref} data-testid="export-excel">
            <Icon name="download" size={16} /> Eksportēt Excel
          </a>
        }
      />
      <Flash ok={typeof sp.ok === 'string' ? sp.ok : undefined} error={typeof sp.error === 'string' ? sp.error : undefined} />

      {period ? (
        <section className="card section-accent" aria-labelledby="h-period-state">
          <div className="card-title">
            <h2 id="h-period-state">Perioda statuss</h2>
            <PeriodStatusBadge status={period.status} />
          </div>
          <p className="muted" style={{ marginBottom: '0.75rem' }}>
            Iesniegšanas termiņš: <strong style={{ color: 'var(--black)' }}>{formatDateTime(period.submission_deadline)}</strong>
          </p>
          <div className="btn-row">
            {['closed', 'collecting'].includes(period.status) ? (
              <form action={periodWorkflowAction}>
                <input type="hidden" name="period_id" value={period.id} />
                <input type="hidden" name="op" value="open" />
                <input type="hidden" name="back" value={back} />
                <button className="btn btn-sm" type="submit">
                  Atvērt periodu pieteikumiem
                </button>
              </form>
            ) : null}
            {period.status === 'open' ? (
              <form action={periodWorkflowAction}>
                <input type="hidden" name="period_id" value={period.id} />
                <input type="hidden" name="op" value="close" />
                <input type="hidden" name="back" value={back} />
                <button className="btn btn-sm" type="submit">
                  Slēgt iesniegšanu
                </button>
              </form>
            ) : null}
            {['open', 'closed', 'collecting'].includes(period.status) ? (
              <>
                <ConfirmAction
                  action={periodWorkflowAction}
                  label="Iekļaut pasūtījumā"
                  question="Visus iesniegtos un apstiprinātos pieteikumus atzīmēt kā «Iekļauts pasūtījumā»?"
                  confirmLabel="Jā, iekļaut"
                  className="btn btn-sm"
                  hidden={{ period_id: period.id, op: 'include', back }}
                />
                <ConfirmAction
                  action={periodWorkflowAction}
                  label="Atzīmēt kā pasūtītu"
                  question="Atzīmēt pieteikumus un periodu kā «Pasūtīts»?"
                  confirmLabel="Jā, pasūtīts"
                  className="btn btn-sm btn-dark"
                  hidden={{ period_id: period.id, op: 'ordered', back }}
                />
              </>
            ) : null}
            {['closed', 'collecting', 'ordered'].includes(period.status) ? (
              <ConfirmAction
                action={periodWorkflowAction}
                label="Arhivēt periodu"
                question="Arhivēt periodu?"
                confirmLabel="Jā, arhivēt"
                className="btn btn-sm"
                hidden={{ period_id: period.id, op: 'archive', back }}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <FilterBar
        action="/pasutijums"
        filters={filters}
        reference={reference}
        teachers={teachersRes.data ?? []}
        productName={(productRes.data as { name: string } | null)?.name}
        defaultStatuses={ORDER_STATUSES}
        submitLabel="Rādīt pasūtījumu"
      />

      {unapproved > 0 ? (
        <Alert tone="warn">
          Pasūtījumā ir <strong>{unapproved}</strong> neapstiprinātas vai noraidītas preces. <Link href="/jaunas-preces">Izskatīt jaunās preces →</Link>
        </Alert>
      ) : null}

      <p className="muted" aria-live="polite">
        Pozīcijas: <strong style={{ color: 'var(--black)' }}>{rows.length}</strong>. Apkopošana notiek automātiski pēc preces (product_id) un mērvienības; dažādas mērvienības netiek summētas kopā.
      </p>
      {/* key: pēc filtru maiņas atvērtās detalizācijas un kešs tiek notīrīti */}
      <SummaryTable key={query} rows={rows} query={query} />
    </>
  );
}
