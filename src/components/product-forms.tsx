'use client';

import { ActionForm, type FormState } from '@/components/action-form';
import type { Category, Unit } from '@/lib/types';

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export interface ProductDefaults {
  id?: string;
  name?: string;
  category_id?: string | null;
  base_unit_id?: string;
  order_unit_id?: string;
  package_description?: string | null;
  package_quantity?: string | null;
  barcode?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

/** Preces izveides / labošanas forma (administratoram) */
export function ProductForm({
  action,
  units,
  categories,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  units: Unit[];
  categories: Category[];
  defaults?: ProductDefaults;
  submitLabel: string;
}) {
  const activeUnits = units.filter((u) => u.is_active || u.id === defaults.base_unit_id || u.id === defaults.order_unit_id);
  const firstUnit = activeUnits.find((u) => u.code === 'kg') ?? activeUnits[0];
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="pr-name">Nosaukums *</label>
          <input id="pr-name" name="name" className="input" required maxLength={200} defaultValue={defaults.name ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="pr-cat">Kategorija</label>
          <select id="pr-cat" name="category_id" className="select" defaultValue={defaults.category_id ?? ''}>
            <option value="">— bez kategorijas —</option>
            {categories
              .filter((c) => c.is_active || c.id === defaults.category_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pr-base">Pamatmērvienība *</label>
          <select id="pr-base" name="base_unit_id" className="select" required defaultValue={defaults.base_unit_id ?? firstUnit?.id}>
            {activeUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pr-order">Pasūtīšanas mērvienība *</label>
          <select id="pr-order" name="order_unit_id" className="select" required defaultValue={defaults.order_unit_id ?? firstUnit?.id}>
            {activeUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
              </option>
            ))}
          </select>
          <div className="field-hint">Šī mērvienība tiek automātiski aizpildīta pieteikumā.</div>
        </div>
        <div className="field">
          <label htmlFor="pr-pkg">Iepakojuma apraksts</label>
          <input id="pr-pkg" name="package_description" className="input" maxLength={200} defaultValue={defaults.package_description ?? ''} placeholder="piem., 1×0,5 kg" />
        </div>
        <div className="field">
          <label htmlFor="pr-pkgq">Daudzums iepakojumā (pamatvienībās)</label>
          <input id="pr-pkgq" name="package_quantity" className="input" inputMode="decimal" defaultValue={defaults.package_quantity ?? ''} placeholder="piem., 0,5" />
          <div className="field-hint">Izmanto papildu aprēķinam kopējā pasūtījumā (nav obligāts).</div>
        </div>
        <div className="field">
          <label htmlFor="pr-bar">Svītrkods</label>
          <input id="pr-bar" name="barcode" className="input" maxLength={64} defaultValue={defaults.barcode ?? ''} />
        </div>
        <div className="field span-all">
          <label htmlFor="pr-notes">Piezīmes</label>
          <input id="pr-notes" name="notes" className="input" maxLength={500} defaultValue={defaults.notes ?? ''} />
        </div>
        {defaults.id ? (
          <div className="field">
            <label className="check">
              <input type="checkbox" name="is_active" defaultChecked={defaults.is_active ?? true} /> Aktīva (izvēlama jauniem pieteikumiem)
            </label>
          </div>
        ) : null}
      </div>
    </ActionForm>
  );
}

/** Pedagoga forma jaunas preces ierosināšanai (kataloga lapā) */
export function ProposeForm({ action, units, categories }: { action: Action; units: Unit[]; categories: Category[] }) {
  const active = units.filter((u) => u.is_active);
  const kg = active.find((u) => u.code === 'kg') ?? active[0];
  return (
    <ActionForm action={action} submitLabel="Ierosināt preci" pendingLabel="Ierosina…" resetOnSuccess>
      <p className="muted small">
        Ja preci katalogā neatradāt, ierosiniet to. Jūs to varēsiet izmantot pieteikumā, bet administratoram tā būs jāapstiprina.
      </p>
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="np2-name">Nosaukums *</label>
          <input id="np2-name" name="name" className="input" required minLength={2} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="np2-unit">Mērvienība *</label>
          <select id="np2-unit" name="unit_id" className="select" required defaultValue={kg?.id}>
            {active.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="np2-cat">Kategorija (ja zināt)</label>
          <select id="np2-cat" name="category_id" className="select" defaultValue="">
            <option value="">— nezinu —</option>
            {categories
              .filter((c) => c.is_active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field span-all">
          <label htmlFor="np2-notes">Piezīme</label>
          <input id="np2-notes" name="notes" className="input" maxLength={500} />
        </div>
      </div>
    </ActionForm>
  );
}
