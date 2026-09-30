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
