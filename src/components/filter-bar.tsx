import { ProductFilter } from '@/components/product-filter';
import { periodLabel, type Reference } from '@/lib/data';
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES, ORDER_STATUSES, type RequestStatus } from '@/lib/labels';
import type { OrderFilters } from '@/lib/order-filters';

/**
 * Administratora filtru josla (GET forma — filtri ir kombinējami un saglabājas URL).
 * `defaultStatuses` — kuri statusi ir atzīmēti, kamēr lietotājs nav izvēlējies citus.
 */
export function FilterBar({
  action,
  filters,
  reference,
  teachers,
  productName,
  showStatuses = true,
  defaultStatuses,
  hidden,
  submitLabel = 'Filtrēt',
}: {
  action: string;
  filters: OrderFilters;
  reference: Reference;
  teachers: Array<{ id: string; full_name: string }>;
  productName?: string;
  showStatuses?: boolean;
  defaultStatuses?: RequestStatus[];
  hidden?: Record<string, string>;
  submitLabel?: string;
}) {
  const checked = new Set<RequestStatus>(filters.statuses ?? defaultStatuses ?? []);
  return (
    // key: pēc filtru maiņas (Back, sānjoslas saite, lapošana) kontroles tiek pārbūvētas ar jaunajām vērtībām
    <form key={JSON.stringify(filters)} method="get" action={action} className="card" aria-label="Filtri">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="filters">
        <div className="field">
          <label htmlFor="flt-period">Periods</label>
          <select id="flt-period" name="period" className="select" defaultValue={filters.period ?? ''}>
            <option value="">Visi periodi</option>
            {reference.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="flt-from">Datums no</label>
          <input id="flt-from" name="from" type="date" className="input" defaultValue={filters.from ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="flt-to">Datums līdz</label>
          <input id="flt-to" name="to" type="date" className="input" defaultValue={filters.to ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="flt-teacher">Pedagogs</label>
          <select id="flt-teacher" name="teacher" className="select" defaultValue={filters.teacher ?? ''}>
            <option value="">Visi pedagogi</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="flt-group">Grupa</label>
          <select id="flt-group" name="group" className="select" defaultValue={filters.group ?? ''}>
            <option value="">Visas grupas</option>
            {reference.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="flt-course">Kurss</label>
          <select id="flt-course" name="course" className="select" defaultValue={filters.course ?? ''}>
            <option value="">Visi kursi</option>
            {reference.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="flt-category">Kategorija</label>
          <select id="flt-category" name="category" className="select" defaultValue={filters.category ?? ''}>
            <option value="">Visas kategorijas</option>
            {reference.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <ProductFilter initialId={filters.product} initialName={productName} />
        <div className="field">
          <label htmlFor="flt-topic">Nodarbības tēma</label>
          <input id="flt-topic" name="topic" className="input" defaultValue={filters.topic ?? ''} placeholder="Meklēt tēmā…" maxLength={200} />
        </div>
      </div>
      {showStatuses ? (
        <fieldset style={{ border: 0, padding: 0, margin: '0.75rem 0 0' }}>
          <legend className="label">Pieteikuma statuss</legend>
          <div className="chips">
            {REQUEST_STATUSES.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" name="status" value={s} defaultChecked={checked.has(s)} /> {REQUEST_STATUS_LABEL[s]}
              </label>
            ))}
          </div>
          {!filters.statuses && defaultStatuses === ORDER_STATUSES ? <p className="field-hint">Pēc noklusējuma tiek ņemti vērā iesniegtie, apstiprinātie, iekļautie un pasūtītie pieteikumi.</p> : null}
        </fieldset>
      ) : null}
      <div className="btn-row" style={{ marginTop: '0.85rem' }}>
        <button type="submit" className="btn btn-primary">
          {submitLabel}
        </button>
        <a className="btn" href={action}>
          Notīrīt filtrus
        </a>
      </div>
    </form>
  );
}
