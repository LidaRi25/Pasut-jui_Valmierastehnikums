'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeInternalPath } from '@/lib/safe-path';
import { createClient } from '@/lib/supabase/server';

export interface LoginState {
  error?: string;
  email?: string;
}

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Ievadiet derīgu e-pasta adresi.').max(254),
  password: z.string().min(1, 'Ievadiet paroli.').max(200),
});

function safeNext(value: FormDataEntryValue | null): string {
  const v = safeInternalPath(typeof value === 'string' ? value : '', '/');
  return v.startsWith('/login') ? '/' : v;
}

export async function loginAction(_prev: LoginState | undefined, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Pārbaudiet ievadītos datus.', email: String(formData.get('email') ?? '') };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    const rate = error.status === 429 || error.code === 'over_request_rate_limit';
    return {
      email: parsed.data.email,
      error: rate
        ? 'Pārāk daudz mēģinājumu. Uzgaidiet brīdi un mēģiniet vēlreiz.'
        : error.code === 'email_not_confirmed'
          ? 'E-pasta adrese nav apstiprināta. Sazinieties ar sistēmas administratoru.'
          : error.status && error.status >= 500
            ? 'Pieteikšanās pakalpojums īslaicīgi nav pieejams. Mēģiniet vēlāk.'
            : 'Nepareizs e-pasts vai parole.',
    };
  }
  redirect(safeNext(formData.get('next')));
}
