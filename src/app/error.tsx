'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="center-page" id="saturs">
      <div className="card narrow">
        <h1>Radās kļūda</h1>
        <p className="muted">Notikusi neparedzēta kļūda. Lūdzu, mēģiniet vēlreiz.</p>
        <button className="btn btn-primary" type="button" onClick={() => reset()}>
          Mēģināt vēlreiz
        </button>
      </div>
    </main>
  );
}
