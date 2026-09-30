import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getReference } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { saveGroupAction } from './actions';

export const metadata: Metadata = { title: 'Grupas' };

export default async function GroupsPage() {
  const user = await requireAdmin();
  const canEdit = user.role === 'sysadmin';
  const ref = await getReference();
  const supabase = await createClient();
  // Pieteikumu skaits pa grupām (informācijai)
  const { data: counts } = await supabase.from('requests').select('group_id').not('group_id', 'is', null).limit(20000);
  const perGroup = new Map<string, number>();
  for (const r of (counts ?? []) as Array<{ group_id: string }>) perGroup.set(r.group_id, (perGroup.get(r.group_id) ?? 0) + 1);

  return (
    <>
      <PageHeader title="Grupas un kursi" sub={canEdit ? 'Grupas un kursi tiek izmantoti pieteikumos, filtros un pārskatos.' : 'Grupas pārvalda sistēmas administrators.'} />
      <div className="grid-2">
        <section className="card" aria-labelledby="h-groups">
          <div className="card-title">
            <h2 id="h-groups">Grupas ({ref.groups.length})</h2>
          </div>
          {canEdit ? (
            <ActionForm action={saveGroupAction} submitLabel="Pievienot grupu" resetOnSuccess>
              <input type="hidden" name="kind" value="group" />
              <div className="field">
                <label htmlFor="g-new">Jauna grupa</label>
                <input id="g-new" name="name" className="input" required maxLength={100} placeholder="piem., 6. grupa" />
              </div>
            </ActionForm>
          ) : null}
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
            {ref.groups.map((g) => (
              <li key={g.id} style={{ borderTop: '1px solid var(--line)', padding: '0.5rem 0' }}>
                {canEdit ? (
                  <ActionForm action={saveGroupAction} submitLabel="Saglabāt" submitClassName="btn btn-sm">
                    <input type="hidden" name="kind" value="group" />
                    <input type="hidden" name="id" value={g.id} />
                    <div className="btn-row">
                      <input name="name" className="input input-sm" style={{ maxWidth: 220 }} defaultValue={g.name} required maxLength={100} aria-label={`Grupas nosaukums: ${g.name}`} />
                      <label className="check">
                        <input type="checkbox" name="is_active" defaultChecked={g.is_active} /> Aktīva
                      </label>
                      <span className="muted small">{perGroup.get(g.id) ?? 0} pieteikumi</span>
                    </div>
                  </ActionForm>
                ) : (
                  <span>
                    <strong>{g.name}</strong> {g.is_active ? '' : <span className="badge badge-muted">Neaktīva</span>} <span className="muted small">{perGroup.get(g.id) ?? 0} pieteikumi</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="h-courses">
          <div className="card-title">
            <h2 id="h-courses">Kursi ({ref.courses.length})</h2>
          </div>
          {canEdit ? (
            <ActionForm action={saveGroupAction} submitLabel="Pievienot kursu" resetOnSuccess>
              <input type="hidden" name="kind" value="course" />
              <div className="form-grid">
                <div className="field span-2">
                  <label htmlFor="c-new">Jauns kurss</label>
                  <input id="c-new" name="name" className="input" required maxLength={100} placeholder="piem., 5. kurss" />
                </div>
                <div className="field">
                  <label htmlFor="c-new-sort">Kārtība</label>
                  <input id="c-new-sort" name="sort_order" className="input" inputMode="numeric" defaultValue="50" />
                </div>
              </div>
            </ActionForm>
          ) : null}
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
            {ref.courses.map((c) => (
              <li key={c.id} style={{ borderTop: '1px solid var(--line)', padding: '0.5rem 0' }}>
                {canEdit ? (
                  <ActionForm action={saveGroupAction} submitLabel="Saglabāt" submitClassName="btn btn-sm">
                    <input type="hidden" name="kind" value="course" />
                    <input type="hidden" name="id" value={c.id} />
                    <div className="btn-row">
                      <input name="name" className="input input-sm" style={{ maxWidth: 200 }} defaultValue={c.name} required maxLength={100} aria-label={`Kursa nosaukums: ${c.name}`} />
                      <input name="sort_order" className="input input-sm" style={{ maxWidth: 80 }} defaultValue={c.sort_order} inputMode="numeric" aria-label={`Kārtība: ${c.name}`} />
                      <label className="check">
                        <input type="checkbox" name="is_active" defaultChecked={c.is_active} /> Aktīvs
                      </label>
                    </div>
                  </ActionForm>
                ) : (
                  <strong>{c.name}</strong>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
