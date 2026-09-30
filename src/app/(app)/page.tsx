import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Empty, Flash, PageHeader, PeriodStatusBadge, RequestStatusBadge } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getReference, openPeriods, periodLabel, pickActivePeriod } from '@/lib/data';
import { formatDate, formatDateTime, formatRequestNo, timeLeft } from '@/lib/format';
import { isAdminRole, type RequestStatus } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Sākums' };

interface RecentRow {
  id: string;
  request_no: number;
  topic: string;
  lesson_date: string | null;
  status: RequestStatus;
  updated_at: string;
  profiles: { full_name: string } | null;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title={`Sveiki, ${user.fullName.split(' ')[0]}!`} sub={isAdminRole(user.role) ? 'Pasūtījumu pārskats' : 'Pieteikumi praktiskajām nodarbībām'} />
      <Flash ok={sp.ok} error={sp.error} />
      {isAdminRole(user.role) ? <AdminHome /> : <TeacherHome userId={user.id} />}
    </>
  );
}

async function TeacherHome({ userId }: { userId: string }) {
  const supabase = await createClient();
  const [ref, { data, error }, { count: drafts, error: draftsError }] = await Promise.all([
    getReference(),
    supabase.from('requests').select('id, request_no, topic, lesson_date, status, updated_at').eq('teacher_id', userId).order('updated_at', { ascending: false }).limit(6),
    supabase.from('requests').select('id', { count: 'exact', head: true }).eq('teacher_id', userId).eq('status', 'draft'),
  ]);
  if (error || draftsError) throw new Error('Sākumlapas datus neizdevās ielādēt.');
  const open = openPeriods(ref.periods);
  const rows = (data ?? []) as unknown as RecentRow[];
  return (
    <>
      <div className="grid-2">
        <section className="card section-accent" aria-labelledby="h-period">
          <div className="card-title">
            <h2 id="h-period">Pieteikumu iesniegšana</h2>
          </div>
          {open.length === 0 ? (
            <p className="muted">Pašlaik nav atvērta perioda pieteikumu iesniegšanai. Melnrakstu varat sagatavot jau tagad.</p>
          ) : (
            open.slice(0, 3).map((p) => (
              <div key={p.id} className="deadline" style={{ marginBottom: '0.6rem' }}>
                <div>
                  <div>
                    <strong>{periodLabel(p)}</strong> <PeriodStatusBadge status={p.status} />
                  </div>
                  <div className="muted">
                    Iesniegšanas termiņš: <strong style={{ color: 'var(--black)' }}>{formatDateTime(p.submission_deadline)}</strong> ({timeLeft(p.submission_deadline)})
                  </div>
                </div>
              </div>
            ))
          )}
          <Link className="btn btn-primary" href="/pieteikumi/jauns">
            <Icon name="plus" size={16} /> Jauns pieteikums
          </Link>
        </section>
        <section className="card" aria-labelledby="h-drafts">
          <div className="card-title">
            <h2 id="h-drafts">Melnraksti</h2>
          </div>
          <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--green-ink)', margin: 0 }}>{drafts ?? 0}</p>
          <p className="muted">nepabeigti pieteikumi, kas vēl nav iesniegti.</p>
          <Link className="btn" href="/pieteikumi?status=draft">
            Skatīt melnrakstus
          </Link>
        </section>
      </div>
      <section className="card" style={{ marginTop: '1rem' }} aria-labelledby="h-recent">
        <div className="card-title">
          <h2 id="h-recent">Mani pēdējie pieteikumi</h2>
          <Link href="/pieteikumi">Visi pieteikumi →</Link>
        </div>
        <RecentTable rows={rows} showTeacher={false} />
      </section>
    </>
  );
}

function RecentTable({ rows, showTeacher }: { rows: RecentRow[]; showTeacher: boolean }) {
  if (rows.length === 0) return <Empty>Vēl nav pieteikumu.</Empty>;
  return (
    <div className="table-wrap" style={{ boxShadow: 'none' }}>
      <table className="table table-stack" aria-label="Pēdējie pieteikumi">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Datums</th>
            <th scope="col">Tēma</th>
            {showTeacher ? <th scope="col">Pedagogs</th> : null}
            <th scope="col">Statuss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="ID" className="nowrap">
                <Link href={`/pieteikumi/${r.id}`}>{formatRequestNo(r.request_no)}</Link>
              </td>
              <td data-label="Datums" className="nowrap">
                {formatDate(r.lesson_date) || '—'}
              </td>
              <td data-label="Tēma" className="primary">
                {r.topic || <span className="muted">(bez tēmas)</span>}
              </td>
              {showTeacher ? <td data-label="Pedagogs">{r.profiles?.full_name}</td> : null}
              <td data-label="Statuss">
                <RequestStatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function AdminHome() {
  const supabase = await createClient();
  const ref = await getReference();
  const period = pickActivePeriod(ref.periods);
  const [statsRes, { data: recent, error: recentError }, { data: proposals, error: proposalsError }] = await Promise.all([
    period ? supabase.rpc('dashboard_stats', { p_period_id: period.id }) : Promise.resolve({ data: {}, error: null }),
    supabase
      .from('requests')
      .select('id, request_no, topic, lesson_date, status, updated_at, profiles(full_name)')
      .neq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(8),
    supabase
      .from('product_proposals')
      .select('id, proposed_name, created_at, profiles!product_proposals_proposed_by_fkey(full_name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(6),
  ]);
  // Kļūda nedrīkst izskatīties kā «viss nulle» — rādām kļūdas lapu
  if (statsRes.error || recentError || proposalsError) throw new Error('Sākumlapas datus neizdevās ielādēt.');
  const stats = (statsRes.data ?? {}) as Record<string, number>;
  const upcoming = openPeriods(ref.periods).slice(0, 3);
  const kpi = (value: number | undefined, label: string, href?: string) => (
    <div className="kpi">
      {href ? (
        <Link href={href}>
          <div className="value">{value ?? 0}</div>
          <p className="label">{label}</p>
        </Link>
      ) : (
        <>
          <div className="value">{value ?? 0}</div>
          <p className="label">{label}</p>
        </>
      )}
    </div>
  );

  return (
    <>
      <section className="card section-accent" aria-labelledby="h-active">
        <div className="card-title">
          <h2 id="h-active">Aktīvais periods</h2>
          {period ? (
            <Link className="btn btn-primary btn-sm" href={`/pasutijums?period=${period.id}`}>
              Kopējais pasūtījums →
            </Link>
          ) : null}
        </div>
        {period ? (
          <div className="deadline">
            <strong>{periodLabel(period)}</strong>
            <PeriodStatusBadge status={period.status} />
            <span className="muted">
              Iesniegšanas termiņš: <strong style={{ color: 'var(--black)' }}>{formatDateTime(period.submission_deadline)}</strong> ({timeLeft(period.submission_deadline)})
            </span>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Nav izveidots neviens periods. <Link href="/periodi">Izveidot periodu</Link>, lai pedagogi varētu iesniegt pieteikumus.
          </p>
        )}
      </section>

      <div className="kpis" aria-label="Rādītāji aktīvajam periodam">
        {kpi(stats.submitted_requests, 'Iesniegti pieteikumi', period ? `/pieteikumi?period=${period.id}&status=submitted&status=approved&status=included&status=ordered` : undefined)}
        {kpi(stats.submitted_teachers, 'Pedagogi, kas iesnieguši')}
        {kpi(stats.unique_products, 'Unikālas preces pasūtījumā', period ? `/pasutijums?period=${period.id}` : undefined)}
        {kpi(stats.pending_products, 'Neapstiprinātas jaunas preces', '/jaunas-preces')}
        {kpi(stats.draft_requests, 'Pieteikumi melnrakstā', period ? `/pieteikumi?period=${period.id}&status=draft` : undefined)}
        {kpi(stats.included_positions, 'Pasūtījumā iekļautās pozīcijas')}
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="h-last">
          <div className="card-title">
            <h2 id="h-last">Pēdējie pieteikumi</h2>
            <Link href="/pieteikumi">Visi →</Link>
          </div>
          <RecentTable rows={(recent ?? []) as unknown as RecentRow[]} showTeacher />
        </section>
        <div>
          <section className="card" aria-labelledby="h-new">
            <div className="card-title">
              <h2 id="h-new">Jaunās preces</h2>
              <Link href="/jaunas-preces">Izskatīt →</Link>
            </div>
            {(proposals ?? []).length === 0 ? (
              <Empty>Nav jaunu preču, kas gaida apstiprinājumu.</Empty>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {((proposals ?? []) as unknown as Array<{ id: string; proposed_name: string; profiles: { full_name: string } | null }>).map((p) => (
                  <li key={p.id}>
                    <strong>{p.proposed_name}</strong> <span className="muted small">— {p.profiles?.full_name}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card" aria-labelledby="h-deadline">
            <div className="card-title">
              <h2 id="h-deadline">Tuvojošie termiņi</h2>
              <Link href="/periodi">Periodi →</Link>
            </div>
            {upcoming.length === 0 ? (
              <Empty>Nav atvērtu periodu ar nākotnes termiņu.</Empty>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {upcoming.map((p) => (
                  <li key={p.id}>
                    {periodLabel(p)} — <strong>{formatDateTime(p.submission_deadline)}</strong> <span className="muted">({timeLeft(p.submission_deadline)})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
