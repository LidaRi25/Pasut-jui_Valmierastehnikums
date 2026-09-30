'use client';

import { ActionForm, type FormState } from '@/components/action-form';
import { ProductField } from '@/components/product-filter';

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function AddAliasForm({ action, productId }: { action: Action; productId: string }) {
  return (
    <ActionForm action={action} submitLabel="Pievienot sinonīmu" resetOnSuccess>
      <input type="hidden" name="product_id" value={productId} />
      <div className="field">
        <label htmlFor="alias-new">Jauns sinonīms / pareizrakstības variants</label>
        <input id="alias-new" name="alias" className="input" required maxLength={200} placeholder="piem., Mocarella" />
        <div className="field-hint">Pedagogs, ierakstot šo vārdu, redzēs šo preci. Preces netiek apvienotas automātiski.</div>
      </div>
    </ActionForm>
  );
}

export function MoveAliasForm({ action, aliasId, productId }: { action: Action; aliasId: string; productId: string }) {
  return (
    <ActionForm action={action} submitLabel="Pāradresēt" submitClassName="btn btn-sm">
      <input type="hidden" name="id" value={aliasId} />
      <input type="hidden" name="product_id" value={productId} />
      <ProductField name="target" label="Pāradresēt uz preci" placeholder="Meklēt preci, uz kuru pāradresēt…" required />
    </ActionForm>
  );
}

export function MergeForm({ action, sourceId, sourceName }: { action: Action; sourceId: string; sourceName: string }) {
  return (
    <ActionForm action={action} submitLabel="Apvienot ar izvēlēto preci" submitClassName="btn btn-danger">
      <input type="hidden" name="source" value={sourceId} />
      <ProductField name="target" label="Pareizā prece (ar kuru apvienot)" placeholder="Meklēt pareizo preci…" required />
      <p className="field-hint">
        «{sourceName}» tiks deaktivizēta, visas pieteikumu rindas un sinonīmi tiks pārcelti uz izvēlēto preci, un šī nosaukuma vietā tiks izveidots sinonīms. Darbība tiek reģistrēta audita vēsturē.
      </p>
    </ActionForm>
  );
}
