import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/confirm-action';
import { Icon } from '@/components/icons';
import { RequestEditor } from '@/components/request-editor';
import { RequestView } from '@/components/request-view';
import { StatusChangeForm } from '@/components/status-change-form';
import { Alert, Flash, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getReference, getSettings, periodLabel } from '@/lib/data';
import { formatDateTime, formatRequestNo } from '@/lib/format';
import { isAdminRole } from '@/lib/labels';
import { buildPeriodOptions, headerFromRequest, loadRequest } from '@/lib/request-loader';
import { createClient } from '@/lib/supabase/server';
import { copyRequestAction, deleteRequestAction } from '../actions';
import { AuditTrail } from '@/components/audit-trail';

export const metadata: Metadata = { title: 'Pieteikums' };

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; copied?: string; skipped?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const loaded = await loadRequest(id);
  if (!loaded) notFound();
  const { request, teacherName, items, formItems } = loaded;

  const supabase = await createClient();
  const [ref, settings, canEditRes] = await Promise.all([
    getReference(),
    getSettings(),
    supabase.rpc('can_edit_request', { p_request_id: id }),
  ]);
  const admin = isAdminRole(user.role);
  const canEdit = canEditRes.data === true;
  const period = ref.periods.find((p) => p.id === request.period_id) ?? null;
  const copied = sp.copied !== undefined ? Number(sp.copied) : null;
  const skipped = sp.skipped !== undefined ? Number(sp.skipped) : 0;

  const title = `Pieteikums ${formatRequestNo(request.request_no)}`;
  const sub = admin || request.teacher_id !== user.id ? `Pedagogs: ${teacherName}` : undefined;

  const banner = (
    <>
      <Flash ok={sp.ok} error={sp.error} />
      {copied !== null && Number.isFinite(copied) ? (
        <Alert tone="success">
          Pieteikums nokopēts kā jauns melnraksts ({copied} preces). Norādiet jaunu datumu un pārbaudiet daudzumus.
          {skipped > 0 ? ` ${skipped} preces netika pārkopētas, jo tās vairs nav pieejamas katalogā.` : ''}
        </Alert>
      ) : null}
    </>
  );

  if (canEdit) {
    return (
      <>
        <PageHeader title={title} sub={sub} />
        {banner}
        <RequestEditor
          initial={{
            id: request.id,
            requestNo: request.request_no,
            requestNoLabel: formatRequestNo(request.request_no),
            updatedAt: request.updated_at,
            status: request.status,
            teacherName,
            header: headerFromRequest(request),
            items: formItems,
          }}
          units={ref.units}
          courses={ref.courses}
          groups={ref.groups}
          categories={ref.categories}
          periods={buildPeriodOptions(ref.periods, request.period_id, admin)}
          autosaveSeconds={settings.autosaveSeconds}
          institutionName={settings.institutionName}
        />
        {admin ? <AdminExtras requestId={request.id} status={request.status} /> : null}
      </>
    );
  }

  const lockedReason =
    request.status === 'submitted' && period && new Date(period.submission_deadline) <= new Date()
      ? `Iesniegšanas termiņš (${formatDateTime(period.submission_deadline)}) ir beidzies — pieteikumu vairs nevar labot. Lai veiktu izmaiņas, sazinieties ar pasūtītāju.`
      : request.status === 'submitted' && period && period.status !== 'open'
        ? 'Pasūtījuma periods vairs nav atvērts — pieteikumu nevar labot.'
        : request.status === 'draft'
          ? 'Šo melnrakstu nav iespējams labot.'
          : 'Pieteikums ir apstrādāts, tāpēc to vairs nevar labot. Jūs varat to nokopēt kā jaunu melnrakstu.';

  return (
    <>
      <PageHeader title={title} sub={sub} />
      {banner}
      <RequestView
        request={request}
        teacherName={teacherName}
        items={items}
        courseName={ref.courses.find((c) => c.id === request.course_id)?.name ?? null}
        groupName={ref.groups.find((g) => g.id === request.group_id)?.name ?? null}
        periodName={period ? periodLabel(period) : null}
        institutionName={settings.institutionName}
        lockedReason={lockedReason}
        actions={
          <>
            <form action={copyRequestAction}>
              <input type="hidden" name="id" value={request.id} />
              <button type="submit" className="btn">
                <Icon name="copy" size={16} /> Kopēt pieteikumu
              </button>
            </form>
            <a className="btn" href={`/pieteikumi/${request.id}/druka`} target="_blank" rel="noopener">
              <Icon name="print" size={16} /> Drukāt
            </a>
            <Link className="btn btn-ghost" href="/pieteikumi">
              ← Uz sarakstu
            </Link>
            {request.status === 'draft' || admin ? (
              <ConfirmAction action={deleteRequestAction} label="Dzēst pieteikumu" hidden={{ id: request.id }} question="Dzēst pieteikumu?" />
            ) : null}
          </>
        }
      />
      {admin ? <AdminExtras requestId={request.id} status={request.status} /> : null}
    </>
  );
}

async function AdminExtras({ requestId, status }: { requestId: string; status: import('@/lib/labels').RequestStatus }) {
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="card-title">
        <h2>Administrēšana</h2>
      </div>
      <StatusChangeForm id={requestId} current={status} />
      <hr />
      <h3>Izmaiņu vēsture</h3>
      <AuditTrail entityType="requests" entityId={requestId} />
    </div>
  );
}
