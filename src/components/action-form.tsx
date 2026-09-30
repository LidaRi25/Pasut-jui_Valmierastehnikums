'use client';

import { useRef, useState, useTransition } from 'react';

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
          const result = await action(state, fd);
          setState(result);
          if (result.ok && resetOnSuccess) form.reset();
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
      {children}
      <div className="btn-row" style={{ marginTop: '0.5rem' }}>
        <button type="submit" className={submitClassName} disabled={pending} aria-busy={pending} name={submitName} value={submitValue}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {footer}
      </div>
    </form>
  );
}
