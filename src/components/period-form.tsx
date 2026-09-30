'use client';

import { ActionForm, type FormState } from '@/components/action-form';
import { PERIOD_STATUS_LABEL, PERIOD_STATUSES } from '@/lib/labels';

export function PeriodForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: { id: string; name: string; start_date: string; end_date: string; deadline: string; status: string };
  submitLabel: string;
}) {
  const id = defaults?.id ?? 'new';
  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!defaults}>
      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor={`pn-${id}`}>Nosaukums (neobligāti)</label>
          <input id={`pn-${id}`} name="name" className="input" defaultValue={defaults?.name ?? ''} maxLength={120} placeholder="piem., 05.10.2026.–09.10.2026." />
          <div className="field-hint">Ja atstāsiet tukšu, nosaukums tiks izveidots no datumiem.</div>
        </div>
        <div className="field">
          <label htmlFor={`ps-${id}`}>Sākuma datums *</label>
          <input id={`ps-${id}`} name="start_date" type="date" className="input" required defaultValue={defaults?.start_date ?? ''} />
        </div>
        <div className="field">
          <label htmlFor={`pe-${id}`}>Beigu datums *</label>
          <input id={`pe-${id}`} name="end_date" type="date" className="input" required defaultValue={defaults?.end_date ?? ''} />
        </div>
        <div className="field">
          <label htmlFor={`pd-${id}`}>Pieteikšanās termiņš *</label>
          <input id={`pd-${id}`} name="deadline" type="datetime-local" className="input" required defaultValue={defaults?.deadline ?? ''} />
          <div className="field-hint">Rīgas laiks. Pēc termiņa pedagogi vairs nevar iesniegt vai labot pieteikumus.</div>
        </div>
        <div className="field">
          <label htmlFor={`pt-${id}`}>Statuss</label>
          <select id={`pt-${id}`} name="status" className="select" defaultValue={defaults?.status ?? 'open'}>
            {PERIOD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PERIOD_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </ActionForm>
  );
}
