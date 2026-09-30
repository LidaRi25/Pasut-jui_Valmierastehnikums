import { createClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Parole-2026';

export const USERS = {
  sanita: { email: 'sanita.reinfelde@vt.test', name: 'Sanita Reinfelde' },
  janis: { email: 'janis.berzins@vt.test', name: 'Jānis Bērziņš' },
  ilze: { email: 'ilze.kalnina@vt.test', name: 'Ilze Kalniņa' },
  admin: { email: 'pasutitajs@vt.test', name: 'Pasūtītājs Demo' },
  sysadmin: { email: 'sysadmin@vt.test', name: 'Sistēmas Administrators' },
};

function loadEnv() {
  const file = path.resolve(__dirname, '.tmp/env');
  const env: Record<string, string> = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function service() {
  const { url, service } = loadEnv();
  if (!url || !service) throw new Error('Trūkst Supabase vides mainīgo e2e testiem (skat. e2e/.tmp/env).');
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Izveido atsevišķu periodu ar nākotnes termiņu, lai testi nebūtu atkarīgi no šodienas datuma */
export async function createPeriod(label: string) {
  const sb = service();
  // Unikāli, ar esošajiem periodiem nepārklājošies datumi (periodu automātiskā atlase pēc datuma ir viennozīmīga)
  for (let attempt = 0; attempt < 50; attempt++) {
    const start = new Date(Date.now() + (30 + Math.floor(Math.random() * 3000)) * 86400_000);
    const startDate = start.toISOString().slice(0, 10);
    const end = new Date(start.getTime() + 4 * 86400_000).toISOString().slice(0, 10);
    const overlap = await sb.from('order_periods').select('id').lte('start_date', end).gte('end_date', startDate).limit(1);
    if (overlap.data?.length) continue;
    const { data, error } = await sb
      .from('order_periods')
      .insert({ name: label, start_date: startDate, end_date: end, submission_deadline: new Date(Date.now() + 5 * 86400_000).toISOString(), status: 'open' })
      .select('id, name')
      .single();
    if (error) throw error;
    return { id: data.id as string, name: data.name as string, date: startDate };
  }
  throw new Error('Neizdevās atrast brīvu perioda datumu e2e testam.');
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

export async function logout(page: Page) {
  const btn = page.getByRole('button', { name: /Iziet/ });
  if (await btn.isVisible()) await btn.click();
  else {
    await page.getByRole('button', { name: 'Atvērt izvēlni' }).click();
    await page.getByRole('button', { name: /Iziet/ }).click();
  }
  await page.waitForURL(/\/login/);
}

export interface NewRequest {
  topic: string;
  date: string;
  periodName: string;
  group?: string;
  course?: string;
  items: Array<{ search: string; pick: string | RegExp; qty: string }>;
  submit?: boolean;
}

/** Aizpilda un (pēc izvēles) iesniedz pieteikumu caur reālo interfeisu */
export async function createRequestViaUI(page: Page, req: NewRequest): Promise<string> {
  await page.goto('/pieteikumi/jauns');
  await page.fill('#f-topic', req.topic);
  await page.fill('#f-date', req.date);
  if (req.group) await page.locator('#f-group').selectOption({ label: req.group });
  if (req.course) await page.locator('#f-course').selectOption({ label: req.course });
  // periods: izvēlamies skaidri pēc nosaukuma (automātiskā atlase pēc datuma tiek pārbaudīta atsevišķi)
  const period = page.locator('#f-period');
  const value = await period.locator('option', { hasText: req.periodName }).first().getAttribute('value');
  await period.selectOption(value as string);
  for (let i = 0; i < req.items.length; i++) {
    const it = req.items[i];
    const row = page.getByTestId('item-row').nth(i);
    await row.getByRole('combobox', { name: /^Prece/ }).fill(it.search);
    await page.getByRole('listbox').getByRole('option', { name: it.pick }).first().click();
    await row.getByLabel(/^Daudzums/).fill(it.qty);
    if (i < req.items.length - 1) await page.getByRole('button', { name: 'Pievienot rindu' }).click();
  }
  if (req.submit !== false) {
    await page.getByTestId('submit-request').click();
    await page.waitForURL(/\/pieteikumi\/[0-9a-f-]{36}\?ok=submitted/);
  } else {
    await page.getByTestId('save-draft').click();
    await expect(page.getByTestId('save-status')).toContainText('saglabāts');
  }
  const m = /pieteikumi\/([0-9a-f-]{36})/.exec(page.url());
  return m![1];
}
