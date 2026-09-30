import type { Metadata } from 'next';
import Link from 'next/link';
import { ImportWizard } from '@/components/import-wizard';
import { PageHeader } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';

export const metadata: Metadata = { title: 'Kataloga imports' };

export default async function ImportPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Kataloga imports no Excel / CSV"
        actions={
          <Link className="btn" href="/katalogs">
            ← Uz katalogu
          </Link>
        }
      />
      <ImportWizard />
    </>
  );
}
