import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/ui';
import { requireSysadmin } from '@/lib/auth';
import { getReference, getSettings } from '@/lib/data';
import { toInputValue } from '@/lib/decimal';
import { saveSettingsAction, saveUnitAction } from './actions';

export const metadata: Metadata = { title: 'Iestatījumi' };

export default async function SettingsPage() {
  await requireSysadmin();
  const [settings, ref] = await Promise.all([getSettings(), getReference()]);
  return (
    <>
      <PageHeader title="Iestatījumi" sub="Sistēmas konfigurācija, mērvienības un kategorijas." />
      <div className="grid-2">
        <section className="card" aria-labelledby="h-sys">
          <div className="card-title">
            <h2 id="h-sys">Sistēma</h2>
          </div>
          <ActionForm action={saveSettingsAction} submitLabel="Saglabāt iestatījumus">
            <div className="field">
              <label htmlFor="s-inst">Iestādes nosaukums</label>
              <input id="s-inst" name="institution_name" className="input" defaultValue={settings.institutionName} required maxLength={120} />
              <div className="field-hint">Tiek rādīts pieteikuma veidlapā, drukas skatā un Excel eksportā.</div>
            </div>
            <div className="field">
              <label htmlFor="s-auto">Melnraksta automātiskā saglabāšana (sekundes)</label>
              <input id="s-auto" name="autosave_seconds" className="input" inputMode="numeric" defaultValue={settings.autosaveSeconds} required />
              <div className="field-hint">0 = izslēgta. Ieteicams 3.</div>
            </div>
            <div className="field">
              <label htmlFor="s-foot">Teksts drukas skata apakšā</label>
              <input id="s-foot" name="print_footer" className="input" defaultValue={settings.printFooter} maxLength={300} />
            </div>
          </ActionForm>
          <hr />
          <p>
            <Link href="/katalogs/kategorijas">Pārvaldīt preču kategorijas →</Link>
          </p>
          <p>
            <Link href="/grupas">Pārvaldīt grupas un kursus →</Link>
          </p>
        </section>

        <section className="card" aria-labelledby="h-units">
          <div className="card-title">
            <h2 id="h-units">Mērvienības</h2>
          </div>
          <ActionForm action={saveUnitAction} submitLabel="Pievienot mērvienību" resetOnSuccess>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="un-code">Apzīmējums *</label>
                <input id="un-code" name="code" className="input" required maxLength={20} placeholder="piem., pudele" />
              </div>
              <div className="field">
                <label htmlFor="un-name">Nosaukums *</label>
                <input id="un-name" name="name" className="input" required maxLength={60} />
              </div>
              <div className="field">
                <label htmlFor="un-warn">Brīdinājuma slieksnis</label>
                <input id="un-warn" name="warn_quantity" className="input" inputMode="decimal" placeholder="piem., 50" />
              </div>
              <div className="field">
                <label htmlFor="un-sort">Kārtība</label>
                <input id="un-sort" name="sort_order" className="input" inputMode="numeric" defaultValue="90" />
              </div>
              <div className="field">
                <label className="check">
                  <input type="checkbox" name="is_countable" /> Skaitāma vienība (veseli skaitļi)
                </label>
              </div>
            </div>
          </ActionForm>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
            {ref.units.map((u) => (
              <li key={u.id} style={{ borderTop: '1px solid var(--line)', padding: '0.6rem 0' }}>
                <ActionForm action={saveUnitAction} submitLabel="Saglabāt" submitClassName="btn btn-sm">
                  <input type="hidden" name="id" value={u.id} />
                  <div className="filters" style={{ alignItems: 'end' }}>
                    <div className="field">
                      <label htmlFor={`uc-${u.id}`}>Apzīmējums</label>
                      <input id={`uc-${u.id}`} name="code" className="input input-sm" defaultValue={u.code} required maxLength={20} />
                    </div>
                    <div className="field">
                      <label htmlFor={`un-${u.id}`}>Nosaukums</label>
                      <input id={`un-${u.id}`} name="name" className="input input-sm" defaultValue={u.name} required maxLength={60} />
                    </div>
                    <div className="field">
                      <label htmlFor={`uw-${u.id}`}>Brīdinājums pie</label>
                      <input id={`uw-${u.id}`} name="warn_quantity" className="input input-sm" inputMode="decimal" defaultValue={toInputValue(u.warn_quantity)} />
                    </div>
                    <div className="field">
                      <label htmlFor={`us-${u.id}`}>Kārtība</label>
                      <input id={`us-${u.id}`} name="sort_order" className="input input-sm" inputMode="numeric" defaultValue={u.sort_order} />
                    </div>
                    <div className="field">
                      <label className="check">
                        <input type="checkbox" name="is_countable" defaultChecked={u.is_countable} /> Skaitāma
                      </label>
                    </div>
                    <div className="field">
                      <label className="check">
                        <input type="checkbox" name="is_active" defaultChecked={u.is_active} /> Aktīva
                      </label>
                    </div>
                  </div>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
