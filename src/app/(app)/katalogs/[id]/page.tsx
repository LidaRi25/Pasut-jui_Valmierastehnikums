import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditTrail } from '@/components/audit-trail';
import { ConfirmAction } from '@/components/confirm-action';
import { AddAliasForm, MergeForm, MoveAliasForm } from '@/components/product-admin-forms';
import { ProductForm } from '@/components/product-forms';
import { ApprovalBadge, Flash, PageHeader } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getReference } from '@/lib/data';
import { numStr } from '@/lib/decimal';
import { UUID_RE } from '@/lib/request-loader';
import { createClient } from '@/lib/supabase/server';
import { addAliasAction, deleteAliasAction, mergeProductAction, moveAliasAction, updateProductAction } from '../actions';

export const metadata: Metadata = { title: 'Prece' };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { ok } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const ref = await getReference();
  const { data: product } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  if (!product) notFound();
  const [{ data: aliases }, { count: usage }, { data: mergedFrom }, { data: mergedInto }] = await Promise.all([
    supabase.from('product_aliases').select('id, alias').eq('product_id', id).order('alias'),
    supabase.from('request_items').select('id', { count: 'exact', head: true }).eq('product_id', id),
    supabase.from('products').select('id, name').eq('merged_into', id),
    product.merged_into ? supabase.from('products').select('id, name').eq('id', product.merged_into).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return (
    <>
      <PageHeader
        title={product.name}
        sub={
          <>
            <ApprovalBadge status={product.approval_status} /> {product.is_active ? 'Aktīva prece' : 'Neaktīva prece'} · izmantota {usage ?? 0} pieteikumu rindās
            {usage ? (
              <>
                {' '}
                (<Link href={`/pieteikumi?product=${id}`}>skatīt pieteikumus</Link>)
              </>
            ) : null}
          </>
        }
        actions={
          <Link className="btn" href="/katalogs">
            ← Uz katalogu
          </Link>
        }
      />
      <Flash ok={ok} />
      {mergedInto ? (
        <div className="alert alert-warn">
          Šī prece ir apvienota ar <Link href={`/katalogs/${(mergedInto as { id: string }).id}`}>{(mergedInto as { name: string }).name}</Link> un vairs netiek izmantota.
        </div>
      ) : null}

      <div className="grid-2">
        <section className="card" aria-labelledby="h-edit">
          <div className="card-title">
            <h2 id="h-edit">Preces dati</h2>
          </div>
          <ProductForm
            action={updateProductAction}
            units={ref.units}
            categories={ref.categories}
            submitLabel="Saglabāt izmaiņas"
            defaults={{
              id: product.id,
              name: product.name,
              category_id: product.category_id,
              base_unit_id: product.base_unit_id,
              order_unit_id: product.order_unit_id,
              package_description: product.package_description,
              package_quantity: numStr(product.package_quantity),
              barcode: product.barcode,
              notes: product.notes,
              is_active: product.is_active,
            }}
          />
        </section>

        <div>
          <section className="card" aria-labelledby="h-alias">
            <div className="card-title">
              <h2 id="h-alias">Sinonīmi (alias)</h2>
            </div>
            {(aliases ?? []).length === 0 ? (
              <p className="muted">Nav pievienotu sinonīmu.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
                {(aliases ?? []).map((a) => (
                  <li key={a.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="btn-row" style={{ justifyContent: 'space-between' }}>
                      <strong>{a.alias}</strong>
                      <ConfirmAction action={deleteAliasAction} label="Dzēst" question="Dzēst sinonīmu?" hidden={{ id: a.id, product_id: id }} />
                    </div>
                    <details className="inline" style={{ marginTop: '0.25rem' }}>
                      <summary className="small">Pāradresēt uz citu preci</summary>
                      <MoveAliasForm action={moveAliasAction} aliasId={a.id} />
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <AddAliasForm action={addAliasAction} productId={id} />
          </section>

          {!product.merged_into ? (
            <section className="card" aria-labelledby="h-merge">
              <div className="card-title">
                <h2 id="h-merge">Apvienot kļūdaini izveidotu preci</h2>
              </div>
              <p className="muted small">Izmantojiet, ja šī prece ir dublikāts vai drukas kļūda un jāapvieno ar pareizo preci katalogā.</p>
              <MergeForm action={mergeProductAction} sourceId={id} sourceName={product.name} />
            </section>
          ) : null}
        </div>
      </div>

      {(mergedFrom ?? []).length > 0 ? (
        <section className="card">
          <h3>Apvienotās preces</h3>
          <ul>
            {(mergedFrom ?? []).map((m) => (
              <li key={m.id}>{m.name}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card" aria-labelledby="h-hist">
        <div className="card-title">
          <h2 id="h-hist">Izmaiņu vēsture</h2>
        </div>
        <AuditTrail entityType="products" entityId={id} />
      </section>
    </>
  );
}
