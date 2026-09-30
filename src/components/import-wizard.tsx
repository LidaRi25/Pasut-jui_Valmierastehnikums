'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { commitImportAction, previewImportAction, type PreviewData, type PreviewRow } from '@/app/(app)/katalogs/imports/actions';

const KIND_LABEL: Record<string, string> = {
  exact: 'jau ir katalogā',
  alias: 'sakrīt ar sinonīmu',
  similar: 'līdzīga prece',
  in_file: 'dublikāts failā',
};

const STATUS_LABEL: Record<PreviewRow['status'], string> = {
  ok: 'Derīga',
  warning: 'Pārbaudīt',
  conflict: 'Konflikts',
  error: 'Kļūda',
};

export function ImportWizard() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<{ inserted: number; skipped: number } | null>(null);

  const counts = useMemo(() => {
    const c = { ok: 0, warning: 0, conflict: 0, error: 0 };
    for (const r of preview?.rows ?? []) c[r.status]++;
    return c;
  }, [preview]);

  const onPreview = (fd: FormData) => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await previewImportAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res.preview);
      setSelected(new Set(res.preview.rows.filter((r) => r.include).map((r) => r.index)));
    });
  };

  const onCommit = () => {
    if (!preview) return;
    setError(null);
    const rows = preview.rows
      .filter((r) => selected.has(r.index) && r.unit_id)
      .map((r) => ({
        name: r.name,
        unit_id: r.unit_id,
        category_id: r.category_id,
        package_description: r.packaging || null,
        notes: r.notes || null,
      }));
    if (rows.length === 0) {
      setError('Neviena rinda nav atzīmēta importam.');
      return;
    }
    startTransition(async () => {
      const res = await commitImportAction(JSON.stringify(rows));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone({ inserted: res.inserted, skipped: res.skipped });
      setPreview(null);
    });
  };

  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div>
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {done ? (
        <div className="alert alert-success" role="status">
          Imports pabeigts: pievienotas <strong>{done.inserted}</strong> preces
          {done.skipped ? `, izlaistas ${done.skipped} (nosaukums jau eksistēja)` : ''}. <Link href="/katalogs">Skatīt katalogu</Link>
        </div>
      ) : null}

      {!preview ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            onPreview(new FormData(e.currentTarget));
          }}
        >
          <h2>1. Izvēlieties failu</h2>
          <p className="muted small">
            Atbalstītie formāti: Excel (.xlsx) vai CSV. Kolonnas: <strong>Preces nosaukums</strong>, <strong>Mērvienība</strong>, Kategorija, Iepakojums, Piezīme. Pirms importa tiks parādīts priekšskatījums — neviena prece netiks pievienota, kamēr to neapstiprināsiet.
          </p>
          <div className="field">
            <label htmlFor="imp-file">Fails (līdz 5 MB)</label>
            <input id="imp-file" name="file" type="file" className="input" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Nolasa…' : 'Nolasīt un parādīt priekšskatījumu'}
          </button>
        </form>
      ) : (
        <div>
          <div className="card">
            <h2>2. Priekšskatījums — {preview.fileName}</h2>
            <p>
              Rindas: <strong>{preview.rows.length}</strong> · derīgas {counts.ok} · jāpārbauda {counts.warning} · konflikti {counts.conflict} · kļūdas {counts.error}
            </p>
            {preview.truncated ? <div className="alert alert-warn">Fails satur pārāk daudz rindu; tika nolasītas pirmās 20 000.</div> : null}
            {preview.warnings.map((w) => (
              <div key={w} className="alert alert-warn">
                {w}
              </div>
            ))}
            <p className="muted small">
              Preces netiek apvienotas automātiski. Konfliktu rindas (jau ir katalogā / dublikāti) pēc noklusējuma netiek importētas; līdzīgas preces ir atzīmētas — pārbaudiet, vai tās ir dažādas (piem., «Sviests 1×0,2 kg» un «Sviests 1×0,5 kg»).
            </p>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={onCommit} disabled={pending}>
                {pending ? 'Importē…' : `Importēt izvēlētās (${selected.size})`}
              </button>
              <button type="button" className="btn" onClick={() => setSelected(new Set(preview.rows.filter((r) => r.status === 'ok' || r.status === 'warning').map((r) => r.index)))}>
                Atzīmēt derīgās
              </button>
              <button type="button" className="btn" onClick={() => setSelected(new Set())}>
                Noņemt visas
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>
                Atcelt
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table" aria-label="Importa priekšskatījums">
              <thead>
                <tr>
                  <th scope="col">Imports</th>
                  <th scope="col">Rinda</th>
                  <th scope="col">Nosaukums</th>
                  <th scope="col">Mērv.</th>
                  <th scope="col">Kategorija</th>
                  <th scope="col">Iepakojums</th>
                  <th scope="col">Statuss</th>
                  <th scope="col">Piezīmes</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index} className={r.status === 'error' ? 'row-error' : r.status === 'conflict' || r.status === 'warning' ? 'row-warn' : ''}>
                    <td>
                      <input type="checkbox" checked={selected.has(r.index)} disabled={r.status === 'error'} onChange={() => toggle(r.index)} aria-label={`Importēt ${r.line}. rindu: ${r.name}`} />
                    </td>
                    <td>{r.line}</td>
                    <td className="primary">{r.name}</td>
                    <td>{r.unit_code}</td>
                    <td>{r.category_name}</td>
                    <td>{r.packaging}</td>
                    <td>
                      <span className={`badge ${r.status === 'ok' ? 'badge-green' : r.status === 'error' ? 'badge-warn' : 'badge-neutral'}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="small">
                      {r.issues.map((i) => (
                        <div key={i}>{i}</div>
                      ))}
                      {r.conflicts.map((c, i) => (
                        <div key={i}>
                          {KIND_LABEL[c.kind]}: <strong>{c.product}</strong>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
