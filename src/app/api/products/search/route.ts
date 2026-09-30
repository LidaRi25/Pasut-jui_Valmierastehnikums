import { NextResponse, type NextRequest } from 'next/server';
import { actionUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Preču typeahead: meklēšana notiek datubāzē (search_products), pārlūkā netiek ielādēts viss katalogs. */
export async function GET(request: NextRequest) {
  const user = await actionUser();
  if (!user) return NextResponse.json({ error: 'Nepieciešama pieteikšanās.' }, { status: 401 });
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 100);
  if (q.trim().length < 2) return NextResponse.json({ items: [] });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_products', { p_query: q, p_limit: 12 });
  if (error) {
    console.error('[search_products]', error.code, error.message);
    return NextResponse.json({ error: 'Meklēšana nav pieejama.' }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
