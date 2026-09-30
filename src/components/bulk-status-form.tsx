'use client';

import { useActionState } from 'react';
import { setRequestStatusAction, type BulkState } from '@/app/(app)/pieteikumi/actions';
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES } from '@/lib/labels';
import { SubmitButton } from '@/components/submit-button';

export const BULK_FORM_ID = 'bulk-status-form';

/** "Atzīmēt visus" izvēles rūtiņa — pārslēdz visas rindu rūtiņas, kas piesaistītas masveida formai */
export function SelectAllCheckbox() {
  return (
    <input
      type="checkbox"
      aria-label="Atzīmēt visus saraksta pieteikumus"
      onChange={(e) => {
        document
          .querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="id"][form="${BULK_FORM_ID}"]`)
          .forEach((c) => {
            c.checked = e.currentTarget.checked;
          });
      }}
    />
  );
}

/**
 * Masveida statusa maiņa. Rindu izvēles rūtiņas (name="id") atrodas tabulā un tiek piesaistītas šai formai
 * ar atribūtu form="bulk-status-form" (tabulā ir savas formas, tāpēc ligzdošana nav iespējama).
 */
export function BulkStatusForm() {
  const [state, action] = useActionState<BulkState, FormData>(setRequestStatusAction, {});
  return (
    <form action={action} id={BULK_FORM_ID} className="card">
      {state.error ? (
        <div className="alert alert-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.ok ? (
        <div className="alert alert-success" role="status">
          Statuss nomainīts {state.count} pieteikumiem.
        </div>
      ) : null}
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bulk-status">Mainīt atzīmēto pieteikumu statusu uz</label>
          <select id="bulk-status" name="status" className="select select-sm" defaultValue="">
            <option value="" disabled>
              — izvēlieties —
            </option>
            {REQUEST_STATUSES.filter((s) => s !== 'draft').map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn btn-sm" pendingText="Maina…">
          Mainīt statusu
        </SubmitButton>
      </div>
    </form>
  );
}
