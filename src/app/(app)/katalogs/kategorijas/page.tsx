import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getReference } from '@/lib/data';
import { saveCategoryAction } from './actions';

export const metadata: Metadata = { title: 'Kategorijas' };

export default async function CategoriesPage() {
  await requireAdmin();
  const ref = await getReference();
  return (
    <>
      <PageHeader
        title="Preču kategorijas"
        sub="Kategorijas tiek izmantotas katalogā, filtros un Excel atskaitēs."
        actions={
          <Link className="btn" href="/katalogs">
            ← Uz katalogu
          </Link>
        }
      />
      <section className="card">
        <div className="card-title">
          <h2>Jauna kategorija</h2>
        </div>
        <ActionForm action={saveCategoryAction} submitLabel="Pievienot" resetOnSuccess>
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="cat-new">Nosaukums</label>
              <input id="cat-new" name="name" className="input" required maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="cat-new-sort">Kārtība</label>
              <input id="cat-new-sort" name="sort_order" className="input" inputMode="numeric" defaultValue="500" />
            </div>
          </div>
        </ActionForm>
      </section>
      <section className="card" aria-labelledby="h-cats">
        <div className="card-title">
          <h2 id="h-cats">Esošās kategorijas ({ref.categories.length})</h2>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ref.categories.map((c) => (
            <li key={c.id} style={{ borderTop: '1px solid var(--line)', padding: '0.6rem 0' }}>
              <ActionForm action={saveCategoryAction} submitLabel="Saglabāt" submitClassName="btn btn-sm">
                <input type="hidden" name="id" value={c.id} />
                <div className="filters" style={{ alignItems: 'end' }}>
                  <div className="field" style={{ gridColumn: 'span 2' }}>
                    <label htmlFor={`c-${c.id}`}>Nosaukums</label>
                    <input id={`c-${c.id}`} name="name" className="input input-sm" defaultValue={c.name} required maxLength={100} />
                  </div>
                  <div className="field">
                    <label htmlFor={`s-${c.id}`}>Kārtība</label>
                    <input id={`s-${c.id}`} name="sort_order" className="input input-sm" inputMode="numeric" defaultValue={c.sort_order} />
                  </div>
                  <div className="field">
                    <label className="check">
                      <input type="checkbox" name="is_active" defaultChecked={c.is_active} /> Aktīva
                    </label>
                  </div>
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
