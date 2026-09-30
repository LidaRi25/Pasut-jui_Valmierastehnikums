// Vides mainīgo nolasīšana ar skaidru kļūdas paziņojumu (izstrādātājam; gala lietotājs to neredz).

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Trūkst vides mainīgā ${name}. Skatiet .env.example un README.md.`);
  }
  return value;
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublicKey(): string {
  return required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function supabaseServiceKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Vai sesijas sīkdatnēm jābūt Secure. Ražošanā (HTTPS) — jā. Ja NEXT_PUBLIC_SITE_URL ir norādīts kā http://…
 * (lokāla izstrāde / testi bez HTTPS), Secure netiek uzstādīts, citādi sīkdatnes netiktu sūtītas.
 */
export function cookieSecure(): boolean {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.startsWith('https://');
  return process.env.NODE_ENV === 'production';
}
