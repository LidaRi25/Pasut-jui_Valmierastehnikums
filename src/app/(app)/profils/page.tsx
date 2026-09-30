import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/labels';
import { changePasswordAction, updateProfileAction } from './actions';

export const metadata: Metadata = { title: 'Profils' };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Profils" sub="Jūsu vārds tiek automātiski izmantots kā «Pasniedzējs» katrā pieteikumā." />
      <div className="grid-2">
        <section className="card" aria-labelledby="h-prof">
          <div className="card-title">
            <h2 id="h-prof">Mani dati</h2>
          </div>
          <dl className="meta-list" style={{ marginBottom: '1rem' }}>
            <div>
              <dt>E-pasts</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Loma</dt>
              <dd>{ROLE_LABEL[user.role]}</dd>
            </div>
          </dl>
          <ActionForm action={updateProfileAction} submitLabel="Saglabāt vārdu">
            <div className="field">
              <label htmlFor="p-name">Vārds, uzvārds</label>
              <input id="p-name" name="full_name" className="input" defaultValue={user.fullName} required maxLength={120} autoComplete="name" />
            </div>
          </ActionForm>
        </section>
        <section className="card" aria-labelledby="h-pass">
          <div className="card-title">
            <h2 id="h-pass">Mainīt paroli</h2>
          </div>
          <ActionForm action={changePasswordAction} submitLabel="Nomainīt paroli" resetOnSuccess>
            <div className="field">
              <label htmlFor="p-pass">Jaunā parole</label>
              <input id="p-pass" name="password" type="password" className="input" required minLength={8} autoComplete="new-password" />
              <div className="field-hint">Vismaz 8 simboli.</div>
            </div>
            <div className="field">
              <label htmlFor="p-pass2">Atkārtojiet jauno paroli</label>
              <input id="p-pass2" name="confirm" type="password" className="input" required minLength={8} autoComplete="new-password" />
            </div>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
