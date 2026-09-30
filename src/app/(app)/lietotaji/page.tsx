import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { ConfirmAction } from '@/components/confirm-action';
import { PageHeader } from '@/components/ui';
import { requireSysadmin } from '@/lib/auth';
import { ROLE_LABEL, type AppRole } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { createUserAction, grantAccessAction, resetPasswordAction, revokeAccessAction, updateUserAction } from './actions';

export const metadata: Metadata = { title: 'Lietotāji' };

interface UserRow {
  id: string;
  email: string | null;
  full_name: string;
  is_active: boolean;
  user_roles: { role: AppRole } | null;
}

export default async function UsersPage() {
  const me = await requireSysadmin();
  const supabase = await createClient();
  const [{ data }, { data: grants }] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, is_active, user_roles(role)').order('full_name'),
    supabase.from('teacher_access_grants').select('owner_id, grantee_id, can_edit'),
  ]);
  const users = (data ?? []) as unknown as UserRow[];
  const nameOf = (id: string) => users.find((u) => u.id === id)?.full_name ?? id;
  const roleOptions = (Object.keys(ROLE_LABEL) as AppRole[]).map((r) => (
    <option key={r} value={r}>
      {ROLE_LABEL[r]}
    </option>
  ));

  return (
    <>
      <PageHeader title="Lietotāji" sub="Konti tiek izveidoti šeit — publiska reģistrācija ir izslēgta. Lietotājus nedzēš, bet deaktivizē." />

      <section className="card section-accent">
        <div className="card-title">
          <h2>Jauns lietotājs</h2>
        </div>
        <ActionForm action={createUserAction} submitLabel="Izveidot lietotāju" resetOnSuccess>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="u-email">E-pasts *</label>
              <input id="u-email" name="email" type="email" className="input" required autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="u-name">Vārds, uzvārds *</label>
              <input id="u-name" name="full_name" className="input" required maxLength={120} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="u-role">Loma</label>
              <select id="u-role" name="role" className="select" defaultValue="teacher">
                {roleOptions}
              </select>
            </div>
            <div className="field">
              <label htmlFor="u-pass">Parole (neobligāta)</label>
              <input id="u-pass" name="password" type="text" className="input" autoComplete="off" placeholder="tiks ģenerēta automātiski" />
              <div className="field-hint">Vismaz 8 simboli. Lietotājs to var nomainīt sadaļā «Profils».</div>
            </div>
          </div>
        </ActionForm>
      </section>

      <section className="card" aria-labelledby="h-users">
        <div className="card-title">
          <h2 id="h-users">Visi lietotāji ({users.length})</h2>
        </div>
        {users.map((u) => (
          <div key={u.id} style={{ borderTop: '1px solid var(--line)', padding: '0.75rem 0' }} data-testid="user-row">
            <ActionForm action={updateUserAction} submitLabel="Saglabāt" submitClassName="btn btn-sm">
              <input type="hidden" name="id" value={u.id} />
              <div className="filters" style={{ alignItems: 'end' }}>
                <div className="field">
                  <label htmlFor={`un-${u.id}`}>Vārds, uzvārds</label>
                  <input id={`un-${u.id}`} name="full_name" className="input input-sm" defaultValue={u.full_name} required maxLength={120} />
                </div>
                <div className="field">
                  <span className="label">E-pasts</span>
                  <div style={{ padding: '0.35rem 0' }}>{u.email}</div>
                </div>
                <div className="field">
                  <label htmlFor={`ur-${u.id}`}>Loma</label>
                  <select id={`ur-${u.id}`} name="role" className="select select-sm" defaultValue={u.user_roles?.role ?? 'teacher'}>
                    {roleOptions}
                  </select>
                </div>
                <div className="field">
                  <label className="check">
                    <input type="checkbox" name="is_active" defaultChecked={u.is_active} disabled={u.id === me.id} /> Aktīvs
                  </label>
                  {u.id === me.id ? <input type="hidden" name="is_active" value="on" /> : null}
                </div>
              </div>
            </ActionForm>
            <details className="inline" style={{ marginTop: '0.4rem' }}>
              <summary className="small">Atiestatīt paroli</summary>
              <ActionForm action={resetPasswordAction} submitLabel="Nomainīt paroli" submitClassName="btn btn-sm">
                <input type="hidden" name="id" value={u.id} />
                <div className="field" style={{ maxWidth: 320 }}>
                  <label htmlFor={`up-${u.id}`}>Jaunā parole</label>
                  <input id={`up-${u.id}`} name="password" className="input input-sm" autoComplete="off" placeholder="tiks ģenerēta automātiski" />
                </div>
              </ActionForm>
            </details>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="h-grants">
        <div className="card-title">
          <h2 id="h-grants">Papildu piekļuve pieteikumiem</h2>
        </div>
        <p className="muted small">Pēc noklusējuma pedagogs redz tikai savus pieteikumus. Šeit varat atļaut vienam pedagogam skatīt (vai arī labot) cita pedagoga pieteikumus.</p>
        {(grants ?? []).length > 0 ? (
          <ul style={{ paddingLeft: '1.1rem' }}>
            {(grants ?? []).map((g) => (
              <li key={`${g.owner_id}-${g.grantee_id}`} style={{ marginBottom: '0.3rem' }}>
                <strong>{nameOf(g.grantee_id)}</strong> {g.can_edit ? 'var skatīt un labot' : 'var skatīt'} pieteikumus, kurus iesniedzis <strong>{nameOf(g.owner_id)}</strong>{' '}
                <ConfirmAction action={revokeAccessAction} label="Noņemt" question="Noņemt piekļuvi?" confirmLabel="Jā, noņemt" hidden={{ owner_id: g.owner_id, grantee_id: g.grantee_id }} />
              </li>
            ))}
          </ul>
        ) : null}
        <ActionForm action={grantAccessAction} submitLabel="Piešķirt piekļuvi" resetOnSuccess>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="g-grantee">Kam piešķirt piekļuvi</label>
              <select id="g-grantee" name="grantee_id" className="select" required defaultValue="">
                <option value="" disabled>
                  — izvēlieties —
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="g-owner">Kura pedagoga pieteikumiem</label>
              <select id="g-owner" name="owner_id" className="select" required defaultValue="">
                <option value="" disabled>
                  — izvēlieties —
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="check" style={{ marginTop: '1.6rem' }}>
                <input type="checkbox" name="can_edit" /> Drīkst arī labot
              </label>
            </div>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
