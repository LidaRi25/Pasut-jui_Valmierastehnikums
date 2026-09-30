import { NextResponse, type NextRequest } from 'next/server';
import { actionUser } from '@/lib/auth';
import { isAdminRole } from '@/lib/labels';
import { loadLines } from '@/lib/order-data';
import { parseOrderFilters } from '@/lib/order-filters';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Preces detalizācija: no kuriem sākotnējiem pieteikumiem izveidojusies kopsumma (product + unit + tie paši filtri). */
export async function GET(request: NextRequest) {
  const user = await actionUser();
  if (!user) return NextResponse.json({ error: 'Nepieciešama pieteikšanās.' }, { status: 401 });
  if (!isAdminRole(user.role)) return NextResponse.json({ error: 'Nav tiesību.' }, { status: 403 });
  const filters = parseOrderFilters(request.nextUrl.searchParams);
  if (!filters.product) return NextResponse.json({ error: 'Nav norādīta prece.' }, { status: 400 });
  const unit = request.nextUrl.searchParams.get('unit');
  try {
    const supabase = await createClient();
    const lines = await loadLines(supabase, filters);
    return NextResponse.json({ lines: unit ? lines.filter((l) => l.unit_id === unit) : lines });
  } catch (e) {
    console.error('[order/lines]', e);
    return NextResponse.json({ error: 'Detalizāciju neizdevās ielādēt.' }, { status: 500 });
  }
}
