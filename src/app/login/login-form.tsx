'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';
import { SubmitButton } from '@/components/submit-button';

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} noValidate>
      {state.error ? (
        <div className="alert alert-error" role="alert">
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="next" value={next ?? '/'} />
      <div className="field">
        <label htmlFor="email">E-pasts</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="username"
          defaultValue={state.email}
          required
          autoFocus
        />
      </div>
      <div className="field">
        <label htmlFor="password">Parole</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      <SubmitButton className="btn btn-primary" pendingText="Pieteicas…">
        Pieteikties
      </SubmitButton>
    </form>
  );
}
