import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="center-page" id="saturs">
      <div className="card narrow">
        <h1>Lapa nav atrasta</h1>
        <p className="muted">Meklētā lapa neeksistē vai Jums nav tiesību to skatīt.</p>
        <Link className="btn btn-primary" href="/">
          Uz sākumu
        </Link>
      </div>
    </main>
  );
}
