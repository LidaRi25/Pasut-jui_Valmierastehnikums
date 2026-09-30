'use client';

import { useState } from 'react';
import { ProductCombobox } from '@/components/product-combobox';

/** Preces izvēle ar typeahead, kas iesniedz product_id kā slēptu lauku (filtriem un admin formām) */
export function ProductField({
  name = 'product',
  label = 'Prece',
  initialId,
  initialName,
  required,
  placeholder = 'Meklēt preci…',
}: {
  name?: string;
  label?: string;
  initialId?: string;
  initialName?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [id, setId] = useState(initialId ?? '');
  const [query, setQuery] = useState(initialName ?? '');
  const inputId = `pf-${name}`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input type="hidden" name={name} value={id} required={required} />
      <div style={{ display: 'flex', gap: '0.3rem' }}>
        <div style={{ flex: 1 }}>
          <ProductCombobox
            inputId={inputId}
            query={query}
            selected={Boolean(id)}
            placeholder={placeholder}
            ariaLabel={label}
            onQueryChange={(q) => {
              setQuery(q);
              if (id) setId('');
            }}
            onSelect={(hit) => {
              setId(hit.id);
              setQuery(hit.name);
            }}
          />
        </div>
        {id ? (
          <button
            type="button"
            className="btn btn-icon"
            aria-label={`Notīrīt: ${label}`}
            onClick={() => {
              setId('');
              setQuery('');
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

export const ProductFilter = ProductField;
