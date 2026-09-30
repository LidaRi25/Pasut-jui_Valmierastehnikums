'use client';

import { useState } from 'react';

/**
 * Divpakāpju apstiprinājums bez modālā loga: pirmā poga atver "Vai tiešām?" ar pogām "Jā" / "Nē".
 * `action` ir Server Action, ko izsauc forma.
 */
export function ConfirmAction({
  action,
  label,
  confirmLabel = 'Jā, dzēst',
  question = 'Vai tiešām?',
  hidden,
  className = 'btn btn-sm btn-danger',
}: {
  action: (formData: FormData) => void | Promise<void>;
  label: React.ReactNode;
  confirmLabel?: string;
  question?: string;
  hidden?: Record<string, string>;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <form action={action} className="btn-row" style={{ display: 'inline-flex' }}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <span className="small">{question}</span>
      <button type="submit" className="btn btn-sm btn-danger">
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setAsking(false)}>
        Nē
      </button>
    </form>
  );
}
