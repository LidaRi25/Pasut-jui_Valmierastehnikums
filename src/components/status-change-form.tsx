'use client';

import { useActionState } from 'react';
import { setRequestStatusAction, type BulkState } from '@/app/(app)/pieteikumi/actions';
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES, type RequestStatus } from '@/lib/labels';
import { SubmitButton } from '@/components/submit-button';

export function StatusChangeForm({ id, current }: { id: string; current: RequestStatus }) {
  const [state, action] = useActionState<BulkState, FormData>(setRequestStatusAction, {});
  return (
    <form action={action} className="toolbar" style={{ marginBottom: 0 }}>
      <input type="hidden" name="id" value={id} />
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="status-change">Pieteikuma statuss</label>
        <select id="status-change" name="status" className="select select-sm" defaultValue={current}>
          {REQUEST_STATUSES.filter((s) => s !== 'draft' || current === 'draft').map((s) => (
            <option key={s} value={s}>
              {REQUEST_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton className="btn btn-sm" pendingText="Maina…">
        Mainīt statusu
      </SubmitButton>
      {state.error ? (
        <span className="field-error" role="alert">
          {state.error}
        </span>
      ) : null}
      {state.ok ? <span className="badge badge-green">Statuss nomainīts</span> : null}
    </form>
  );
}
