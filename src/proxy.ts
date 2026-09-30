import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Proxy (Next.js 16; agrāk "middleware"): sesijas atjaunošana, pieteikšanās pieprasīšana un CSP ar nonce.
// Svarīgi: šī ir tikai pirmā aizsardzības līnija. Katra lapa, Server Action un API ceļš atkārtoti pārbauda
// lomu serverī (src/lib/auth.ts), un datus galīgi aizsargā Row Level Security datubāzē.

const PUBLIC_PATHS = new Set(['/login', '/api/health']);

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${supabase}${isDev ? ' ws: wss:' : ''}`.trim(),
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const pendingCookies: Array<{ name: string; value: string; options?: Parameters<typeof response.cookies.set>[2] }> = [];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return new NextResponse('Sistēma nav konfigurēta (trūkst Supabase vides mainīgo).', { status: 503 });
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          pendingCookies.push({ name, value, options });
        }
        requestHeaders.set('cookie', request.headers.get('cookie') ?? '');
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const c of pendingCookies) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });

  // getUser() pārbauda JWT ar Supabase Auth serveri (nevis tikai nolasa sīkdatni)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.has(path);

  const withSession = (r: NextResponse) => {
    for (const c of pendingCookies) r.cookies.set(c.name, c.value, c.options);
    r.headers.set('Content-Security-Policy', csp);
    return r;
  };

  if (!user && !isPublic) {
    if (path.startsWith('/api/')) {
      return withSession(NextResponse.json({ error: 'Nepieciešama pieteikšanās.' }, { status: 401 }));
    }
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    if (path !== '/') login.searchParams.set('next', path + request.nextUrl.search);
    return withSession(NextResponse.redirect(login));
  }
  if (user && path === '/login') {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return withSession(NextResponse.redirect(home));
  }

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: [
    // Visi ceļi, izņemot statiskos failus
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
