import type { Metadata } from 'next';
import { RequestEditor } from '@/components/request-editor';
import { PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getReference, getSettings } from '@/lib/data';
import { isAdminRole } from '@/lib/labels';
import { emptyRow } from '@/lib/request-form';
import { buildPeriodOptions } from '@/lib/request-loader';

export const metadata: Metadata = { title: 'Jauns pieteikums' };

export default async function NewRequestPage() {
  const user = await requireUser();
  const [ref, settings] = await Promise.all([getReference(), getSettings()]);
  const periods = buildPeriodOptions(ref.periods, null, isAdminRole(user.role));
  const selectable = periods.filter((p) => p.selectable);
  return (
    <>
      <PageHeader title="Jauns pieteikums" sub="Norādiet nodarbības datus un pievienojiet vajadzīgās preces." />
      <RequestEditor
        // Jauns key katram apmeklējumam: pārejot uz "Jauns pieteikums" no jau saglabāta melnraksta, forma sākas tukša
        key={crypto.randomUUID()}
        initial={{
          id: null,
          requestNo: null,
          requestNoLabel: '',
          updatedAt: null,
          status: 'draft',
          teacherName: user.fullName,
          header: {
            periodId: selectable.length === 1 ? selectable[0].id : '',
            courseId: '',
            groupId: '',
            students: '',
            topic: '',
            lessonDate: '',
            studentCount: '',
            notes: '',
          },
          items: [emptyRow(crypto.randomUUID())],
        }}
        units={ref.units}
        courses={ref.courses}
        groups={ref.groups}
        categories={ref.categories}
        periods={periods}
        autosaveSeconds={settings.autosaveSeconds}
        institutionName={settings.institutionName}
      />
    </>
  );
}
