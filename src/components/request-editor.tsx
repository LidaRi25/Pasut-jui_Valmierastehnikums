'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { copyRequestAction, deleteRequestAction, proposeProductAction, saveRequestAction, submitRequestAction } from '@/app/(app)/pieteikumi/actions';
import { ConfirmAction } from '@/components/confirm-action';
import { Icon } from '@/components/icons';
import { ProductCombobox } from '@/components/product-combobox';
import { RequestStatusBadge } from '@/components/ui';
import { formatRequestNo } from '@/lib/format';
import { parseDecimal, toInputValue } from '@/lib/decimal';
import type { RequestStatus } from '@/lib/labels';
import {
  emptyRow,
  findDuplicates,
  isMeaningful,
  mergeDuplicateRows,
  toPayload,
  validateForm,
  type FormHeader,
  type FormItem,
  type Issue,
} from '@/lib/request-form';
import type { Category, Course, Group, ProductHit, Unit } from '@/lib/types';

export interface PeriodOption {
  id: string;
  label: string;
  start: string;
  end: string;
  deadline: string;
  selectable: boolean;
}

export interface EditorInitial {
  id: string | null;
  requestNo: number | null;
  requestNoLabel: string;
  /** Pieteikuma pēdējā versija (updated_at) optimistiskajai bloķēšanai; null jaunam pieteikumam */
  updatedAt: string | null;
  status: RequestStatus;
  teacherName: string;
  header: FormHeader;
  items: FormItem[];
}

interface Props {
  initial: EditorInitial;
  units: Unit[];
  courses: Course[];
  groups: Group[];
  categories: Category[];
  periods: PeriodOption[];
  autosaveSeconds: number;
  institutionName: string;
}

type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; at?: Date; message?: string };
type CellField = 'prod' | 'qty' | 'notes';

interface Proposal {
  key: string;
  name: string;
  unitId: string;
  categoryId: string;
  notes: string;
  busy: boolean;
  error?: string;
}

const newKey = () => crypto.randomUUID();

function timeLabel(d: Date) {
  return d.toLocaleTimeString('lv-LV', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Riga' });
}

export function RequestEditor({ initial, units, courses, groups, categories, periods, autosaveSeconds, institutionName }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [header, setHeader] = useState<FormHeader>(initial.header);
  const [items, setItems] = useState<FormItem[]>(initial.items.length ? initial.items : [emptyRow(newKey())]);
  const [requestNo, setRequestNo] = useState<string>(initial.requestNoLabel);
  const [requestId, setRequestId] = useState<string | null>(initial.id);
  const [saveState, setSaveState] = useState<SaveState>(initial.id ? { kind: 'saved' } : { kind: 'idle' });
  const [showValidation, setShowValidation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [periodHint, setPeriodHint] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const idRef = useRef<string | null>(initial.id);
  const updatedAtRef = useRef<string | null>(initial.updatedAt);
  const stateRef = useRef({ header, items });
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const cellRefs = useRef(new Map<string, Partial<Record<CellField, HTMLInputElement | null>>>());
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const headerRefs = useRef<Record<string, HTMLElement | null>>({});
  const doneRef = useRef(false);
  const pendingFocus = useRef<{ key: string; field: CellField } | null>(null);

  const isDraft = initial.status === 'draft';
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const activeUnits = useMemo(() => units.filter((u) => u.is_active), [units]);

  useEffect(() => {
    stateRef.current = { header, items };
  }, [header, items]);

  const touch = useCallback(() => {
    versionRef.current += 1;
    setVersion(versionRef.current);
  }, []);

  // ---------- Saglabāšana (secīga rinda, lai autosave un manuālā saglabāšana nesaskrietos) ----------
  const doSave = useCallback((): Promise<{ ok: true } | { ok: false; error: string }> => {
    const run = async () => {
      const { header: h, items: its } = stateRef.current;
      const v = versionRef.current;
      if (idRef.current && v === savedVersionRef.current) return { ok: true as const };
      setSaveState({ kind: 'saving' });
      const payload = toPayload(h, its);
      const res = await saveRequestAction({
        id: idRef.current,
        data: { ...payload.data, expected_updated_at: idRef.current ? updatedAtRef.current : null },
        items: payload.items,
      });
      if (res.ok) {
        updatedAtRef.current = res.updatedAt;
        savedVersionRef.current = Math.max(savedVersionRef.current, v);
        if (!idRef.current) {
          idRef.current = res.id;
          setRequestId(res.id);
          // Adrese kļūst par /pieteikumi/<id> (atsvaidzināšana atver saglabāto melnrakstu). history.replaceState nepārlādē lapu;
          // svarīgi, ka redaktora Server Actions neizsauc revalidatePath — citādi Next pārrenderētu maršrutu un pārmontētu formu.
          window.history.replaceState(null, '', `/pieteikumi/${res.id}`);
          setRequestNo(formatRequestNo(res.requestNo));
        }
        setSaveState({ kind: 'saved', at: new Date() });
        return { ok: true as const };
      }
      setSaveState({ kind: 'error', message: res.error });
      return { ok: false as const, error: res.error };
    };
    const p = queueRef.current.then(run, run);
    queueRef.current = p.catch(() => undefined);
    return p;
  }, []);

  // Autosave: tikai melnrakstam un tikai, ja forma satur kaut ko jēgpilnu
  useEffect(() => {
    if (!isDraft || autosaveSeconds <= 0 || doneRef.current) return;
    if (version === savedVersionRef.current) return;
    if (!isMeaningful(header, items)) return;
    const t = setTimeout(() => {
      void doSave();
    }, autosaveSeconds * 1000);
    return () => clearTimeout(t);
  }, [version, header, items, isDraft, autosaveSeconds, doSave]);

  // Brīdinājums, aizverot lapu ar nesaglabātām izmaiņām
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!doneRef.current && versionRef.current !== savedVersionRef.current && isMeaningful(stateRef.current.header, stateRef.current.items)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Fokusa pārvietošana uz tikko izveidotu rindu (tā DOM parādās pēc renderēšanas)
  useEffect(() => {
    const req = pendingFocus.current;
    if (!req) return;
    const el = cellRefs.current.get(req.key)?.[req.field];
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  /** Pārvieto fokusu uz šūnu; ja rinda vēl nav renderēta, fokuss tiek atlikts līdz nākamajai renderēšanai */
  const focusCell = useCallback((key: string, field: CellField) => {
    const el = cellRefs.current.get(key)?.[field];
    if (el) el.focus();
    else pendingFocus.current = { key, field };
  }, []);

  // ---------- Galvenes lauki ----------
  const setField = <K extends keyof FormHeader>(k: K, v: FormHeader[K]) => {
    setHeader((h) => ({ ...h, [k]: v }));
    touch();
  };

  const onDateChange = (date: string) => {
    // Periodu atlasa automātiski pēc datuma: ja pašreizējais periods datumu neaptver, ņem to atvērto periodu,
    // kas datumu aptver (ja to ir vairāki — to ar tuvāko iesniegšanas termiņu).
    let periodId = header.periodId;
    const current = periods.find((p) => p.id === header.periodId);
    const covering = periods.filter((p) => p.selectable && date >= p.start && date <= p.end).sort((a, b) => a.deadline.localeCompare(b.deadline));
    if (date && covering.length > 0 && (!current || date < current.start || date > current.end)) {
      periodId = covering[0].id;
      setPeriodHint('Periods atlasīts automātiski pēc datuma.');
    }
    setHeader((h) => ({ ...h, lessonDate: date, periodId }));
    touch();
  };

  // ---------- Rindas ----------
  const patchItem = useCallback(
    (key: string, patch: Partial<FormItem>) => {
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
      touch();
    },
    [touch],
  );

  const selectProduct = (key: string, hit: ProductHit) => {
    const unit = unitById.get(hit.unit_id);
    patchItem(key, {
      productId: hit.id,
      productName: hit.name,
      query: hit.name,
      unitId: hit.unit_id,
      unitCode: hit.unit_code,
      unitCountable: unit?.is_countable ?? false,
      unitWarn: unit?.warn_quantity ?? null,
      defaultUnitId: hit.unit_id,
      defaultUnitCode: hit.unit_code,
      packageDescription: hit.package_description,
      approval: hit.approval_status,
    });
  };

  const addRow = (focus: CellField = 'prod', afterKey?: string) => {
    const row = emptyRow(newKey());
    setItems((prev) => {
      if (!afterKey) return [...prev, row];
      const idx = prev.findIndex((i) => i.key === afterKey);
      return [...prev.slice(0, idx + 1), row, ...prev.slice(idx + 1)];
    });
    touch();
    pendingFocus.current = { key: row.key, field: focus };
  };

  const removeRow = (key: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.key !== key);
      return next.length ? next : [emptyRow(newKey())];
    });
    if (proposal?.key === key) setProposal(null);
    touch();
  };

  const duplicateRow = (key: string) => {
    const src = items.find((i) => i.key === key);
    if (!src) return;
    const copy: FormItem = { ...src, key: newKey() };
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.key === key);
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
    touch();
    pendingFocus.current = { key: copy.key, field: 'qty' };
  };

  const focusNextRowProduct = (key: string) => {
    const idx = items.findIndex((i) => i.key === key);
    const next = items[idx + 1];
    if (next) focusCell(next.key, 'prod');
    else addRow('prod');
  };

  const setCellRef = (key: string, field: CellField) => (el: HTMLInputElement | null) => {
    const cur = cellRefs.current.get(key) ?? {};
    cur[field] = el;
    cellRefs.current.set(key, cur);
  };

  // ---------- Jaunas preces ierosināšana ----------
  const startProposal = (key: string, name: string) => {
    const row = items.find((i) => i.key === key);
    const kg = activeUnits.find((u) => u.code === 'kg') ?? activeUnits[0];
    setProposal({ key, name, unitId: row?.unitId || kg?.id || '', categoryId: '', notes: '', busy: false });
  };

  const submitProposal = async () => {
    if (!proposal) return;
    setProposal({ ...proposal, busy: true, error: undefined });
    const res = await proposeProductAction({
      name: proposal.name,
      unit_id: proposal.unitId,
      category_id: proposal.categoryId || null,
      notes: proposal.notes,
    });
    if (!res.ok) {
      setProposal((p) => (p ? { ...p, busy: false, error: res.error } : p));
      return;
    }
    selectProduct(proposal.key, res.product);
    setProposal(null);
    focusCell(proposal.key, 'qty');
  };

  // ---------- Validācija ----------
  const validation = useMemo(() => validateForm(header, items), [header, items]);
  const duplicates = useMemo(() => findDuplicates(items), [items]);
  const rowNumber = useMemo(() => new Map(items.map((it, i) => [it.key, i + 1])), [items]);

  const visibleIssues = (key: string): Issue[] =>
    (validation.byRow.get(key) ?? []).filter((i) => i.severity === 'warning' || showValidation || (i.code === 'BAD_QTY' && items.find((r) => r.key === key)?.quantity.trim() !== ''));

  const focusIssue = (issue: Issue) => {
    if (issue.target === 'header') {
      const map: Record<string, string> = { topic: 'topic', lessonDate: 'date', period: 'period', product: 'product-add' };
      headerRefs.current[map[issue.field ?? ''] ?? '']?.focus();
    } else {
      focusCell(issue.target, issue.field === 'quantity' ? 'qty' : 'prod');
    }
  };

  // ---------- Darbības ----------
  const onSaveClick = async () => {
    setServerError(null);
    const res = await doSave();
    if (!res.ok) setServerError(res.error);
  };

  const onSubmit = async () => {
    setServerError(null);
    setShowValidation(true);
    const v = validateForm(header, items);
    if (v.errors.length > 0) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    setSubmitting(true);
    // Vispirms saglabājam (tas izveido melnrakstu un piesaista tā ID), tad iesniedzam pēc ID —
    // ja iesniegšana neizdodas, atkārtots mēģinājums nerada otru melnrakstu.
    const saved = await doSave();
    if (!saved.ok || !idRef.current) {
      setSubmitting(false);
      setServerError(saved.ok ? 'Pieteikumu neizdevās saglabāt.' : saved.error);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    const payload = toPayload(header, items);
    const res = await submitRequestAction({
      id: idRef.current,
      data: { ...payload.data, expected_updated_at: updatedAtRef.current },
      items: payload.items,
    });
    if (!res.ok) {
      setSubmitting(false);
      setServerError(res.error);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    doneRef.current = true;
    router.push(`/pieteikumi/${res.id}?ok=submitted`);
  };

  const onCopy = () => {
    startTransition(async () => {
      const res = await doSave();
      if (!res.ok || !idRef.current) {
        if (!res.ok) setServerError(res.error);
        return;
      }
      doneRef.current = true;
      const fd = new FormData();
      fd.set('id', idRef.current);
      await copyRequestAction(fd);
    });
  };

  const statusText =
    saveState.kind === 'saving'
      ? 'Saglabā…'
      : saveState.kind === 'saved'
        ? saveState.at
          ? `${isDraft ? 'Melnraksts saglabāts' : 'Saglabāts'} ${timeLabel(saveState.at)}`
          : 'Visas izmaiņas saglabātas'
        : saveState.kind === 'error'
          ? `Neizdevās saglabāt: ${saveState.message}`
          : isDraft && autosaveSeconds > 0
            ? 'Melnraksts tiks saglabāts automātiski'
            : '';

  const errorsToShow = showValidation ? validation.errors : [];

  return (
    <div className="editor" data-testid="request-editor">
      <div className="form-sheet">
        <div className="sheet-title">
          <div className="org">{institutionName}</div>
          <div className="btn-row">
            {requestNo ? <span className="muted">Pieteikums {requestNo}</span> : <span className="muted">Jauns pieteikums</span>}
            <RequestStatusBadge status={initial.status} />
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="f-course">Mācību kurss</label>
            <select id="f-course" className="select" value={header.courseId} onChange={(e) => setField('courseId', e.target.value)}>
              <option value="">— nav norādīts —</option>
              {courses.filter((c) => c.is_active || c.id === header.courseId).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-group">Grupa</label>
            <select id="f-group" className="select" value={header.groupId} onChange={(e) => setField('groupId', e.target.value)}>
              <option value="">— nav norādīta —</option>
              {groups.filter((g) => g.is_active || g.id === header.groupId).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-students">Audzēknis / audzēkņi (neobligāti)</label>
            <input id="f-students" className="input" maxLength={500} value={header.students} onChange={(e) => setField('students', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-teacher">Pasniedzējs</label>
            <input id="f-teacher" className="input" value={initial.teacherName} readOnly aria-readonly="true" />
          </div>
          <div className="field span-2">
            <label htmlFor="f-topic">Mācību praktiskās nodarbības tēma *</label>
            <input
              id="f-topic"
              ref={(el) => {
                headerRefs.current.topic = el;
              }}
              className="input"
              maxLength={300}
              value={header.topic}
              aria-invalid={showValidation && validation.errors.some((e) => e.code === 'NO_TOPIC') ? true : undefined}
              onChange={(e) => setField('topic', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="f-date">Datums *</label>
            <input
              id="f-date"
              ref={(el) => {
                headerRefs.current.date = el;
              }}
              type="date"
              className="input"
              value={header.lessonDate}
              aria-invalid={showValidation && validation.errors.some((e) => e.code === 'NO_DATE') ? true : undefined}
              onChange={(e) => onDateChange(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="f-count">Audzēkņu skaits</label>
            <input
              id="f-count"
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={header.studentCount}
              onChange={(e) => setField('studentCount', e.target.value.replace(/[^\d]/g, ''))}
            />
          </div>
          <div className="field span-2">
            <label htmlFor="f-period">Pasūtījuma periods *</label>
            <select
              id="f-period"
              ref={(el) => {
                headerRefs.current.period = el;
              }}
              className="select"
              value={header.periodId}
              aria-invalid={showValidation && validation.errors.some((e) => e.code === 'NO_PERIOD') ? true : undefined}
              aria-describedby="f-period-hint"
              onChange={(e) => {
                setPeriodHint(null);
                setField('periodId', e.target.value);
              }}
            >
              <option value="">— izvēlieties periodu —</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.selectable && p.id !== header.periodId}>
                  {p.label}
                  {!p.selectable ? ' (slēgts)' : ''}
                </option>
              ))}
            </select>
            <div className="field-hint" id="f-period-hint">
              {periodHint ?? (periods.some((p) => p.selectable) ? 'Pieteikumu var iesniegt tikai atvērtam periodam līdz tā termiņam.' : 'Pašlaik nav neviena atvērta perioda. Melnrakstu var saglabāt, iesniegt — pēc perioda atvēršanas.')}
            </div>
          </div>
          <div className="field span-all">
            <label htmlFor="f-notes">Piezīmes pieteikumam</label>
            <textarea id="f-notes" className="textarea" rows={2} maxLength={2000} value={header.notes} onChange={(e) => setField('notes', e.target.value)} />
          </div>
        </div>

        <h2 className="list-heading">Vajadzīgo produktu un materiālu saraksts</h2>

        {duplicates.map((d) => (
          <div className="alert alert-warn" role="status" key={`${d.productId}|${d.unitId}`}>
            Prece «{d.name}» pieteikumā ievadīta {d.keys.length} reizes.{' '}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setItems((prev) => mergeDuplicateRows(prev, d.productId, d.unitId));
                touch();
              }}
            >
              Apvienot rindas?
            </button>
          </div>
        ))}

        <div className="items-wrap">
          <table className="items-table" aria-label="Preču un materiālu saraksts">
            <thead>
              <tr>
                <th className="col-no" scope="col">
                  Npk.
                </th>
                <th scope="col">Prece / materiāls</th>
                <th className="col-unit" scope="col">
                  Mērv.
                </th>
                <th className="col-qty" scope="col">
                  Daudzums
                </th>
                <th className="col-notes" scope="col">
                  Piezīmes
                </th>
                <th className="col-act" scope="col">
                  Darbības
                </th>
              </tr>
            </thead>
            <tbody>
              {items.flatMap((it) => {
                const n = rowNumber.get(it.key) ?? 0;
                const issues = visibleIssues(it.key);
                const hasError = issues.some((i) => i.severity === 'error');
                const hasWarn = !hasError && issues.some((i) => i.severity === 'warning' && i.code !== 'EMPTY_ROW');
                const describedBy = issues.length ? `issues-${it.key}` : undefined;
                const rows = [
                  <tr key={it.key} className={`item-row ${hasError ? 'row-error' : hasWarn ? 'row-warn' : ''}`} data-testid="item-row">
                    <td className="col-no">{n}</td>
                    <td className="col-prod">
                      <ProductCombobox
                        query={it.query}
                        selected={it.productId !== null}
                        inputRef={setCellRef(it.key, 'prod')}
                        ariaLabel={`Prece / materiāls, ${n}. rinda`}
                        invalid={hasError && issues.some((i) => i.field === 'product')}
                        describedBy={describedBy}
                        onQueryChange={(q) =>
                          patchItem(it.key, it.productId ? { query: q, productId: null, productName: '', packageDescription: null, approval: 'approved' } : { query: q })
                        }
                        onSelect={(hit) => selectProduct(it.key, hit)}
                        onAfterSelect={() => {
                          // Prece izvēlēta: pēc renderēšanas kursors pāriet uz daudzumu
                          pendingFocus.current = { key: it.key, field: 'qty' };
                        }}
                        onPropose={(q) => startProposal(it.key, q)}
                      />
                      {it.productId && (it.packageDescription || it.approval === 'pending') ? (
                        <div className="row-note muted">
                          {it.packageDescription ? `Iepakojums: ${it.packageDescription}` : ''}
                          {it.approval === 'pending' ? ` ${it.packageDescription ? '· ' : ''}Jauna prece — gaida administratora apstiprinājumu` : ''}
                        </div>
                      ) : null}
                      {issues.length ? (
                        <div id={describedBy}>
                          {issues
                            .map((i) => (
                              <div key={i.code} className={`row-note ${i.severity === 'error' ? 'error' : 'warn'}`}>
                                {i.message}
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="col-unit">
                      <select
                        className="select"
                        aria-label={`Mērvienība, ${n}. rinda`}
                        value={it.unitId}
                        disabled={!it.productId}
                        onChange={(e) => {
                          const u = unitById.get(e.target.value);
                          patchItem(it.key, {
                            unitId: e.target.value,
                            unitCode: u?.code ?? '',
                            unitCountable: u?.is_countable ?? false,
                            unitWarn: u?.warn_quantity ?? null,
                          });
                        }}
                      >
                        {!it.unitId ? <option value="">—</option> : null}
                        {units
                          .filter((u) => u.is_active || u.id === it.unitId)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.code}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="col-qty">
                      <input
                        ref={setCellRef(it.key, 'qty')}
                        className="input"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`Daudzums, ${n}. rinda`}
                        aria-invalid={hasError && issues.some((i) => i.field === 'quantity') ? true : undefined}
                        aria-describedby={describedBy}
                        placeholder="0,0"
                        value={it.quantity}
                        onChange={(e) => patchItem(it.key, { quantity: e.target.value })}
                        onBlur={(e) => {
                          const p = parseDecimal(e.target.value);
                          if (p.ok) {
                            const nice = toInputValue(p.value);
                            if (nice !== e.target.value) patchItem(it.key, { quantity: nice });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusCell(it.key, 'notes');
                          }
                        }}
                      />
                    </td>
                    <td className="col-notes">
                      <input
                        ref={setCellRef(it.key, 'notes')}
                        className="input"
                        aria-label={`Piezīmes, ${n}. rinda`}
                        maxLength={500}
                        value={it.notes}
                        onChange={(e) => patchItem(it.key, { notes: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusNextRowProduct(it.key);
                          }
                        }}
                      />
                    </td>
                    <td className="col-act">
                      <button type="button" className="btn btn-sm btn-icon" aria-label={`Dublēt ${n}. rindu`} title="Dublēt rindu" onClick={() => duplicateRow(it.key)}>
                        <Icon name="copy" size={16} />
                      </button>{' '}
                      <button type="button" className="btn btn-sm btn-icon btn-danger" aria-label={`Dzēst ${n}. rindu`} title="Dzēst rindu" onClick={() => removeRow(it.key)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>,
                ];
                if (proposal && proposal.key === it.key) {
                  rows.push(
                    <tr key={`${it.key}-proposal`} className="item-sub">
                      <td colSpan={6}>
                        <div className="alert alert-info" style={{ margin: '0.3rem 0' }} data-testid="proposal-panel">
                          <strong>Ierosināt jaunu preci</strong>
                          <p className="muted small" style={{ margin: '0.15rem 0 0.5rem' }}>
                            Jauno preci varēsiet izmantot šajā pieteikumā, bet administratoram tā būs jāapstiprina.
                          </p>
                          <div className="form-grid">
                            <div className="field span-2">
                              <label htmlFor="np-name">Nosaukums *</label>
                              <input id="np-name" className="input" value={proposal.name} maxLength={200} onChange={(e) => setProposal({ ...proposal, name: e.target.value })} />
                            </div>
                            <div className="field">
                              <label htmlFor="np-unit">Mērvienība *</label>
                              <select id="np-unit" className="select" value={proposal.unitId} onChange={(e) => setProposal({ ...proposal, unitId: e.target.value })}>
                                {activeUnits.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.code}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field">
                              <label htmlFor="np-cat">Kategorija (ja zināt)</label>
                              <select id="np-cat" className="select" value={proposal.categoryId} onChange={(e) => setProposal({ ...proposal, categoryId: e.target.value })}>
                                <option value="">— nezinu —</option>
                                {categories.filter((c) => c.is_active).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field span-all">
                              <label htmlFor="np-notes">Piezīme</label>
                              <input id="np-notes" className="input" value={proposal.notes} maxLength={500} onChange={(e) => setProposal({ ...proposal, notes: e.target.value })} />
                            </div>
                          </div>
                          {proposal.error ? (
                            <div className="field-error" role="alert">
                              {proposal.error}
                            </div>
                          ) : null}
                          <div className="btn-row" style={{ marginTop: '0.5rem' }}>
                            <button type="button" className="btn btn-primary btn-sm" disabled={proposal.busy || proposal.name.trim().length < 2} onClick={submitProposal}>
                              {proposal.busy ? 'Ierosina…' : 'Ierosināt'}
                            </button>
                            <button type="button" className="btn btn-sm" onClick={() => setProposal(null)}>
                              Atcelt
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        </div>

        <div className="btn-row" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn"
            ref={(el) => {
              headerRefs.current['product-add'] = el;
            }}
            onClick={() => addRow('prod')}
          >
            <Icon name="plus" size={16} /> Pievienot rindu
          </button>
          <span className="muted small">
            Padoms: pēc preces izvēles nospiediet Enter — kursors pāriet uz daudzumu; Enter daudzumā → piezīmes; Enter piezīmēs → nākamā prece.
          </span>
        </div>
      </div>

      {errorsToShow.length > 0 || serverError ? (
        <div ref={errorSummaryRef} tabIndex={-1} className="alert alert-error" role="alert" data-testid="error-summary">
          <strong>Pieteikumu nevar iesniegt. Lūdzu, izlabojiet:</strong>
          <ul>
            {serverError ? <li>{serverError}</li> : null}
            {errorsToShow.map((e, i) => (
              <li key={`${e.code}-${e.target}-${i}`}>
                <button type="button" className="btn btn-sm btn-ghost" style={{ padding: 0, minHeight: 0, textDecoration: 'underline', fontWeight: 500 }} onClick={() => focusIssue(e)}>
                  {e.target !== 'header' && rowNumber.get(e.target) ? `${rowNumber.get(e.target)}. rinda: ` : ''}
                  {e.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="savebar">
        {isDraft ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={submitting || saveState.kind === 'saving'} data-testid="submit-request">
              {submitting ? 'Iesniedz…' : 'Iesniegt'}
            </button>
            <button type="button" className="btn" onClick={onSaveClick} disabled={submitting || saveState.kind === 'saving'} data-testid="save-draft">
              Saglabāt melnrakstu
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onSaveClick} disabled={saveState.kind === 'saving'} data-testid="save-changes">
            Saglabāt izmaiņas
          </button>
        )}
        <Link className="btn btn-ghost" href={requestId ? `/pieteikumi/${requestId}` : '/pieteikumi'} onClick={(e) => {
          if (versionRef.current !== savedVersionRef.current && isMeaningful(header, items) && !window.confirm('Ir nesaglabātas izmaiņas. Vai tiešām atcelt un pamest lapu?')) e.preventDefault();
        }}>
          Atcelt
        </Link>
        {requestId ? (
          <>
            <button type="button" className="btn btn-sm" onClick={onCopy}>
              <Icon name="copy" size={16} /> Kopēt pieteikumu
            </button>
            <a className="btn btn-sm" href={`/pieteikumi/${requestId}/druka`} target="_blank" rel="noopener">
              <Icon name="print" size={16} /> Drukāt
            </a>
            {isDraft ? (
              <ConfirmAction action={deleteRequestAction} label="Dzēst melnrakstu" hidden={{ id: requestId }} question="Dzēst melnrakstu?" />
            ) : null}
          </>
        ) : null}
        <span className={`status ${saveState.kind === 'error' ? 'err' : ''}`} role="status" aria-live="polite" data-testid="save-status">
          {statusText}
        </span>
      </div>
    </div>
  );
}
