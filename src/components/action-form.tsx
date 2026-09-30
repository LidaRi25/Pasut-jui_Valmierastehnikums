'use client';

import { useRef, useState, useTransition } from 'react';
import { GENERIC_ERROR } from '@/lib/errors';

export interface FormState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/**
 * Forma ar Server Action (prev, formData) => FormState. Atšķirībā no <form action> neizdzēš ievadītos datus,
 * ja darbība beidzas ar kļūdu; veiksmes gadījumā (resetOnSuccess) formu notīra.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = 'Saglabā…',
  className,
  submitClassName = 'btn btn-primary',
  resetOnSuccess = false,
  footer,
  submitName,
  submitValue,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  submitClassName?: string;
  resetOnSuccess?: boolean;
  footer?: React.ReactNode;
  submitName?: string;
  submitValue?: string;
}) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(async () => {
          try {
            const result = await action(state, fd);
            setState(result);
            if (result.ok && resetOnSuccess) form.reset();
          } catch (err) {
            // Tīkla/servera kļūda nedrīkst aizstāt lapu ar kļūdas ekrānu un zaudēt lietotāja ievadīto
            console.error('[action-form]', err);
            setState({ error: GENERIC_ERROR });
          }
        });
      }}
    >
      {state.error ? (
        <div className="alert alert-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.ok && state.message ? (
        <div className="alert alert-success" role="status">
          {state.message}
        </div>
      ) : null}
      {/* fieldset disabled: kamēr darbība notiek, visas kontroles (arī papildu pogas) ir bloķētas — nav dubultu izsaukumu */}
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {children}
        <div className="btn-row" style={{ marginTop: '0.5rem' }}>
          <button type="submit" className={submitClassName} aria-busy={pending} name={submitName} value={submitValue}>
            {pending ? pendingLabel : submitLabel}
          </button>
          {footer}
        </div>
      </fieldset>
    </form>
  );
}
