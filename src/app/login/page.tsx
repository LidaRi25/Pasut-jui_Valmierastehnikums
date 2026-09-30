import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Pieteikšanās' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <main className="center-page" id="saturs">
      <div className="card narrow" style={{ width: '100%' }}>
        <div className="brand" style={{ padding: 0, marginBottom: '1.25rem' }}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">
            <strong>Valmieras tehnikums</strong>
            <span>Pārtikas produktu un materiālu pieteikumu sistēma</span>
          </span>
        </div>
        <h1 style={{ fontSize: '1.3rem' }}>Pieteikšanās</h1>
        {error === 'inactive' ? (
          <div className="alert alert-error" role="alert">
            Jūsu konts ir deaktivizēts. Sazinieties ar sistēmas administratoru.
          </div>
        ) : null}
        <LoginForm next={next} />
        <p className="muted small" style={{ marginTop: '1rem', marginBottom: 0 }}>
          Ja nevarat pieteikties vai esat aizmirsis paroli, vērsieties pie sistēmas administratora.
        </p>
      </div>
    </main>
  );
}
