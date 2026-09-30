'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ProductHit } from '@/lib/types';

interface Props {
  /** Ievades lauka teksts (kontrolēts no vecāka) */
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (hit: ProductHit) => void;
  /** Ja norādīts, saraksta beigās parādās "+ Ierosināt jaunu preci" */
  onPropose?: (query: string) => void;
  /** Pēc preces izvēles (Enter/klikšķis) — piem., pārvietot fokusu uz daudzumu */
  onAfterSelect?: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  selected: boolean;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  inputId?: string;
}

function highlight(name: string, q: string) {
  const i = name.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0 || !q.trim()) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + q.trim().length)}</mark>
      {name.slice(i + q.trim().length)}
    </>
  );
}

export function ProductCombobox({
  query,
  onQueryChange,
  onSelect,
  onPropose,
  onAfterSelect,
  inputRef,
  selected,
  invalid,
  describedBy,
  placeholder = 'Sāciet rakstīt preces nosaukumu…',
  ariaLabel = 'Prece / materiāls',
  disabled,
  inputId,
}: Props) {
  const reactId = useId();
  const listId = `${reactId}-list`;
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(false);
  const lastQueryRef = useRef('');

  const canPropose = Boolean(onPropose) && query.trim().length >= 2;
  const optionCount = hits.length + (canPropose ? 1 : 0);

  const runSearch = useCallback((q: string) => {
    abortRef.current?.abort();
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setFailed(false);
    fetch(`/api/products/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { items: ProductHit[] };
      })
      .then((json) => {
        setHits(json.items ?? []);
        setActive(0);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name === 'AbortError') return;
        setFailed(true);
        setHits([]);
        setLoading(false);
      });
  }, []);

  // Meklē tikai tad, kad lietotājs raksta (nevis kad teksts tiek ieliekts pēc preces izvēles)
  useEffect(() => {
    if (!focusedRef.current || selected) return;
    if (lastQueryRef.current === query) return;
    lastQueryRef.current = query;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(query), 120);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, selected, runSearch]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const choose = (hit: ProductHit) => {
    setOpen(false);
    setNavigated(false);
    lastQueryRef.current = hit.name;
    onSelect(hit);
    onAfterSelect?.();
  };

  const proposeNow = () => {
    setOpen(false);
    onPropose?.(query.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (optionCount > 0) {
        setActive((a) => (a + 1) % optionCount);
        setNavigated(true);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (optionCount > 0) {
        setActive((a) => (a - 1 + optionCount) % optionCount);
        setNavigated(true);
      }
    } else if (e.key === 'Enter') {
      if (open && optionCount > 0) {
        e.preventDefault();
        if (active < hits.length) choose(hits[active]);
        else proposeNow();
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Tab') {
      // Tab pieņem izvēli tikai tad, ja lietotājs to apzināti iezīmējis vai ievadītais teksts precīzi sakrīt
      if (open && hits.length > 0 && !e.shiftKey) {
        const candidate = hits[active] ?? hits[0];
        const exact = hits.find((h) => h.name.toLowerCase() === query.trim().toLowerCase());
        if (navigated && active < hits.length) {
          e.preventDefault();
          choose(hits[active]);
        } else if (exact || (candidate && hits.length === 1 && candidate.name.toLowerCase().startsWith(query.trim().toLowerCase()))) {
          e.preventDefault();
          choose(exact ?? candidate);
        }
      }
    }
  };

  const showList = open && !selected && query.trim().length >= 2;

  return (
    <div className="combo">
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        className="input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && optionCount > 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setNavigated(false);
          setOpen(true);
          onQueryChange(e.target.value);
        }}
        onFocus={(e) => {
          focusedRef.current = true;
          if (selected) e.currentTarget.select();
          else if (query.trim().length >= 2) {
            setOpen(true);
            if (hits.length === 0) runSearch(query);
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul className="combo-list" id={listId} role="listbox" aria-label="Preču ieteikumi">
          {loading && hits.length === 0 ? <li className="combo-empty">Meklē…</li> : null}
          {failed ? <li className="combo-empty">Meklēšana īslaicīgi nav pieejama. Mēģiniet vēlreiz.</li> : null}
          {!loading && !failed && hits.length === 0 ? <li className="combo-empty">Katalogā nekas netika atrasts.</li> : null}
          {hits.map((h, i) => (
            <li
              key={h.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="combo-option"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>
                {highlight(h.name, query)}
                {h.matched_alias ? <span className="alias"> (sinonīms: {h.matched_alias})</span> : null}
                {h.approval_status === 'pending' ? <span className="alias"> · neapstiprināta</span> : null}
              </span>
              <span className="meta">
                {h.unit_code}
                {h.category_name ? ` · ${h.category_name}` : ''}
              </span>
            </li>
          ))}
          {canPropose ? (
            <li
              id={`${listId}-${hits.length}`}
              role="option"
              aria-selected={active === hits.length}
              className="combo-option propose"
              onMouseDown={(e) => {
                e.preventDefault();
                proposeNow();
              }}
              onMouseEnter={() => setActive(hits.length)}
            >
              <span>+ Ierosināt jaunu preci «{query.trim()}»</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
