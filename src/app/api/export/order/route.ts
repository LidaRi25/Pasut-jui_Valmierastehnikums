import { NextResponse, type NextRequest } from 'next/server';
import { actionUser } from '@/lib/auth';
import { getReference, getSettings } from '@/lib/data';
import { buildOrderWorkbook } from '@/lib/excel/order-workbook';
import { isAdminRole } from '@/lib/labels';
import { describeFilters, loadLines } from '@/lib/order-data';
import { reportLines, summarizeLines } from '@/lib/order-aggregate';
import { parseOrderFilters } from '@/lib/order-filters';
import { todayRiga } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);

/** Excel eksports: tieši tas periods un filtri, ko administrators izvēlējies (tie paši parametri kā lapā "Kopējais pasūtījums"). */
export async function GET(request: NextRequest) {
  const user = await actionUser();
  if (!user) return NextResponse.json({ error: 'Nepieciešama pieteikšanās.' }, { status: 401 });
  if (!isAdminRole(user.role)) return NextResponse.json({ error: 'Jums nav tiesību eksportēt pasūtījumu.' }, { status: 403 });

  const filters = parseOrderFilters(request.nextUrl.searchParams);
  const supabase = await createClient();
  try {
    const [ref, settings] = await Promise.all([getReference(), getSettings()]);
    // Viens order_lines izvilkums = viens datu momentuzņēmums; visas lapas tiek aprēķinātas no tā (precīza BigInt aritmētika)
    const [lines, desc] = await Promise.all([loadLines(supabase, filters), describeFilters(supabase, filters, ref)]);
    const unitCodes = new Map(ref.units.map((u) => [u.id, u.code]));
    const buffer = await buildOrderWorkbook({
      institution: settings.institutionName,
      periodLabel: desc.periodLabel,
      filterLines: desc.lines,
      generatedAt: new Date(),
      generatedBy: user.fullName,
      summary: summarizeLines(lines, unitCodes),
      lines,
      byTeacher: reportLines(lines, 'teacher'),
      byGroup: reportLines(lines, 'group'),
      byDate: reportLines(lines, 'date'),
      byCategory: reportLines(lines, 'category'),
      countableUnits: new Set(ref.units.filter((u) => u.is_countable).map((u) => u.code)),
    });
    const period = filters.period ? ref.periods.find((p) => p.id === filters.period) : null;
    const name = `pasutijums_${period ? slug(period.name) : 'visi-periodi'}_${todayRiga()}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[export]', e);
    return NextResponse.json({ error: 'Eksportu neizdevās sagatavot. Mēģiniet vēlreiz.' }, { status: 500 });
  }
}
