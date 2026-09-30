'use client';

import { ActionForm, type FormState } from '@/components/action-form';
import { ProductField } from '@/components/product-filter';
import type { Category, Unit } from '@/lib/types';

export function ProposalForm({
  action,
  proposalId,
  name,
  categoryId,
  unitId,
  units,
  categories,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  proposalId: string;
  name: string;
  categoryId: string | null;
  unitId: string;
  units: Unit[];
  categories: Category[];
}) {
  return (
    <ActionForm
      action={action}
      submitLabel="Apstiprināt"
      submitName="intent"
      submitValue="approve"
      pendingLabel="Apstrādā…"
      footer={
        <button type="submit" name="intent" value="reject" className="btn btn-danger" formNoValidate>
          Noraidīt
        </button>
      }
    >
      <input type="hidden" name="id" value={proposalId} />
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor={`pn-${proposalId}`}>Nosaukums (varat pārdēvēt)</label>
          <input id={`pn-${proposalId}`} name="name" className="input" defaultValue={name} maxLength={200} required />
        </div>
        <div className="field">
          <label htmlFor={`pc-${proposalId}`}>Kategorija</label>
          <select id={`pc-${proposalId}`} name="category_id" className="select" defaultValue={categoryId ?? ''}>
            <option value="">— bez kategorijas —</option>
            {categories
              .filter((c) => c.is_active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`pu-${proposalId}`}>Mērvienība</label>
          <select id={`pu-${proposalId}`} name="unit_id" className="select" defaultValue={unitId}>
            {units
              .filter((u) => u.is_active || u.id === unitId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
          </select>
        </div>
        <div className="field span-all">
          <label htmlFor={`pt-${proposalId}`}>Piezīme lēmumam (neobligāti)</label>
          <input id={`pt-${proposalId}`} name="note" className="input" maxLength={500} />
        </div>
      </div>
      <details className="inline" style={{ marginBottom: '0.5rem' }}>
        <summary>Pievienot kā sinonīmu esošai precei (apvienot)</summary>
        <div className="panel">
          <ProductField name="target" label="Esošā prece katalogā" placeholder="Meklēt preci, kurai šis ir sinonīms…" />
          <button type="submit" name="intent" value="merge" className="btn btn-sm" formNoValidate>
            Pievienot kā sinonīmu un apvienot
          </button>
          <p className="field-hint">Pieteikumu rindas ar šo preci tiks pārceltas uz izvēlēto preci, nosaukums kļūs par sinonīmu.</p>
        </div>
      </details>
    </ActionForm>
  );
}
