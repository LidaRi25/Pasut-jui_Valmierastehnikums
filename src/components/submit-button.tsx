'use client';

import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children,
  pendingText = 'Saglabā…',
  className = 'btn btn-primary',
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
