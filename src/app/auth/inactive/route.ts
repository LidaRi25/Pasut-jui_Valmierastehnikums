import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Deaktivizēta lietotāja sesijas beigšana (novērš novirzīšanas ciklu starp /login un /)
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login?error=inactive', request.url));
}
