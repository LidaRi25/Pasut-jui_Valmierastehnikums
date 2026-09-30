import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPeriod, createRequestViaUI, login, logout, PASSWORD, service, USERS } from './helpers';

test.describe.configure({ mode: 'serial' });

let period: { id: string; name: string; date: string };
const stamp = Date.now();
const requestIds: Record<string, string> = {};

async function asUser<T>(browser: Browser, email: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await browser.newContext({ locale: 'lv-LV', timezoneId: 'Europe/Riga', viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, email);
  try {
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

async function parseXlsx(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

/** Kopējā pasūtījuma lapas rindas: prece|mērvienība -> daudzums */
function totals(wb: ExcelJS.Workbook): Map<string, number> {
  const ws = wb.getWorksheet('KOPĒJAIS PASŪTĪJUMS')!;
  const out = new Map<string, number>();
  let inTable = false;
  ws.eachRow((row) => {
    if (row.getCell(1).value === 'Npk.') {
      inTable = true;
      return;
    }
    if (inTable && typeof row.getCell(1).value === 'number') out.set(`${row.getCell(2).value}|${row.getCell(4).value}`, Number(row.getCell(5).value));
  });
  return out;
}

test.beforeAll(async () => {
  period = await createPeriod(`E2E admin ${stamp}`);
});

test.describe('Trīs pedagogi, viens periods: apkopošana un Excel', () => {
  test('pedagogi iesniedz pieteikumus ar vienu un to pašu preci (0,5 + 2 + 1,5 kg)', async ({ browser }) => {
    const plans = [
      { user: USERS.sanita, group: '1. grupa', qty: '0,5', extra: { search: 'sviests 1x0,2', pick: /^Sviests 1×0,2 kg/, qty: '3' } },
      { user: USERS.janis, group: '2. grupa', qty: '2', extra: { search: 'sviests 0,5', pick: /^Sviests 1×0,5 kg/, qty: '2' } },
      { user: USERS.ilze, group: '3. grupa', qty: '1.5', extra: { search: 'bietes', pick: /^Bietes kg/, qty: '1' } },
    ];
    for (const p of plans) {
      await asUser(browser, p.user.email, async (page) => {
        requestIds[p.user.name] = await createRequestViaUI(page, {
          topic: `Apkopojums ${stamp} ${p.user.name.split(' ')[0]}`,
          date: period.date,
          periodName: period.name,
          group: p.group,
          items: [{ search: 'bietes tv', pick: /^Bietes tvaicētas/, qty: p.qty }, p.extra],
        });
      });
    }
    expect(Object.keys(requestIds)).toHaveLength(3);
  });

  test('administrators redz visus pieteikumus un var filtrēt pēc pedagoga un perioda', async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto(`/pieteikumi?period=${period.id}`);
    await expect(page.getByRole('row').filter({ hasText: `Apkopojums ${stamp}` })).toHaveCount(3);
    for (const n of ['Sanita Reinfelde', 'Jānis Bērziņš', 'Ilze Kalniņa']) {
      await expect(page.getByRole('row').filter({ hasText: `Apkopojums ${stamp}` }).filter({ hasText: n })).toHaveCount(1);
    }
    // filtrs pēc pedagoga (kombinējams ar periodu)
    await page.locator('#flt-teacher').selectOption({ label: 'Jānis Bērziņš' });
    await page.getByRole('button', { name: 'Filtrēt' }).click();
    await expect(page.getByRole('row').filter({ hasText: `Apkopojums ${stamp}` })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: 'Jānis Bērziņš' })).toHaveCount(1);
    await page.screenshot({ path: 'e2e/.tmp/shots/10-admin-requests.png' });
  });

  test('kopējais pasūtījums: Bietes tvaicētas = 4,0 kg; līdzīgas preces netiek apvienotas; detalizācija rāda avotus', async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto(`/pasutijums?period=${period.id}`);
    const beet = page.getByTestId('summary-row').filter({ has: page.getByRole('button', { name: 'Bietes tvaicētas', exact: true }) });
    await expect(beet).toHaveCount(1);
    await expect(beet.getByTestId('total-qty')).toHaveText('4,0');
    const cells = await beet.locator('td').allTextContents();
    expect(cells[3]).toBe('kg');
    expect(cells[4]).toBe('3'); // pieteikumu skaits
    expect(cells[5]).toBe('3'); // pedagogu skaits
    expect(cells[6]).toContain('1. grupa');
    // atsevišķas rindas: Bietes (1,0), Sviests 0,2 un 0,5 (dažādi product_id)
    const rowOf = (name: string) => page.getByTestId('summary-row').filter({ has: page.getByRole('button', { name, exact: true }) });
    await expect(rowOf('Bietes').getByTestId('total-qty')).toHaveText('1,0');
    await expect(rowOf('Sviests 1×0,2 kg').getByTestId('total-qty')).toHaveText(/^3\s*≈\s*0,6 kg$/); // 3 gab. × 0,2 kg (papildu info; gab. netiek pārvērstas kg)
    await expect(rowOf('Sviests 1×0,5 kg').getByTestId('total-qty')).toHaveText(/^2\s*≈\s*1,0 kg$/);

    // detalizācija: no kuriem pieteikumiem izveidojusies summa
    await beet.getByRole('button', { name: 'Detalizēti' }).click();
    const detail = page.getByTestId('detail-row');
    await expect(detail).toContainText('3 pieteikuma rindas');
    await expect(detail.getByRole('row').filter({ hasText: 'Sanita Reinfelde' })).toContainText('0,5 kg');
    await expect(detail.getByRole('row').filter({ hasText: 'Jānis Bērziņš' })).toContainText('2,0 kg');
    await expect(detail.getByRole('row').filter({ hasText: 'Ilze Kalniņa' })).toContainText('1,5 kg');
    await expect(detail.getByRole('row').filter({ hasText: 'Sanita Reinfelde' })).toContainText('1. grupa');
    await page.screenshot({ path: 'e2e/.tmp/shots/11-order-detail.png', fullPage: true });
    await detail.getByRole('link', { name: /P-\d+/ }).first().click();
    await expect(page).toHaveURL(/\/pieteikumi\/[0-9a-f-]{36}/);
  });

  test('filtri pasūtījumā: grupa, datums, prece, statuss ir kombinējami un maina summu', async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto(`/pasutijums?period=${period.id}`);
    const total = async () => page.getByTestId('summary-row').filter({ has: page.getByRole('button', { name: 'Bietes tvaicētas', exact: true }) }).getByTestId('total-qty').textContent();
    await page.locator('#flt-group').selectOption({ label: '3. grupa' });
    await page.getByRole('button', { name: 'Rādīt pasūtījumu' }).click();
    await expect.poll(total).toBe('1,5');
    await page.locator('#flt-group').selectOption('');
    await page.locator('#flt-from').fill(period.date);
    await page.locator('#flt-to').fill(period.date);
    await page.locator('#flt-teacher').selectOption({ label: 'Sanita Reinfelde' });
    await page.getByRole('button', { name: 'Rādīt pasūtījumu' }).click();
    await expect.poll(total).toBe('0,5');
    // prece + kategorija
    await page.goto(`/pasutijums?period=${period.id}`);
    await page.locator('#flt-category').selectOption({ label: 'Piena produkti' });
    await page.getByRole('button', { name: 'Rādīt pasūtījumu' }).click();
    await expect(page.getByTestId('summary-row')).toHaveCount(2); // abi sviesti
    // statusi: melnraksti pēc noklusējuma nav iekļauti
    await page.goto(`/pasutijums?period=${period.id}&status=draft`);
    await expect(page.getByText('nav neviena pieteikuma ar precēm')).toBeVisible();
  });

  test('Excel eksports: pareizas lapas, kopsummas un tieši izvēlētie filtri', async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto(`/pasutijums?period=${period.id}`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-excel').click()]);
    expect(download.suggestedFilename()).toMatch(/^pasutijums_e2e-admin-\d+_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const file = path.resolve('e2e/.tmp/export.xlsx');
    await download.saveAs(file);
    const wb = await parseXlsx(fs.readFileSync(file));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['KOPĒJAIS PASŪTĪJUMS', 'DETALIZĒTI', 'PA PEDAGOGIEM', 'PA GRUPĀM', 'PA DATUMIEM', 'PA KATEGORIJĀM']);
    const t = totals(wb);
    expect(t.get('Bietes tvaicētas|kg')).toBe(4);
    expect(t.get('Bietes|kg')).toBe(1);
    expect(t.get('Sviests 1×0,2 kg|gab.')).toBe(3);
    expect(t.get('Sviests 1×0,5 kg|gab.')).toBe(2);
    expect(t.size).toBe(4);
    // detalizētā lapa: 6 rindas, Bietes tvaicētas rindu summa = 4
    const det = wb.getWorksheet('DETALIZĒTI')!;
    let n = 0;
    let sum = 0;
    det.eachRow((row) => {
      if (row.getCell(7).value === 'Bietes tvaicētas') {
        n++;
        sum += Number(row.getCell(9).value);
      }
    });
    expect(n).toBe(3);
    expect(sum).toBe(4);

    // eksports ar filtru (tikai Ilzes pieteikumi) — atspoguļo tieši izvēlēto
    const ilze = await service().from('profiles').select('id').eq('email', USERS.ilze.email).single();
    const res = await page.request.get(`/api/export/order?period=${period.id}&teacher=${ilze.data!.id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('spreadsheetml');
    const t2 = totals(await parseXlsx(Buffer.from(await res.body())));
    expect(t2.get('Bietes tvaicētas|kg')).toBe(1.5);
    expect(t2.size).toBe(2);
    const wb2 = await parseXlsx(Buffer.from(await (await page.request.get(`/api/export/order?period=${period.id}&teacher=${ilze.data!.id}`)).body()));
    const head = wb2.getWorksheet('KOPĒJAIS PASŪTĪJUMS')!;
    const meta: string[] = [];
    head.eachRow((row) => meta.push(String(row.getCell(1).value ?? '')));
    expect(meta.join('\n')).toContain('Pedagogs: Ilze Kalniņa');
  });

  test('statusa maiņa: atcelts pieteikums pazūd no kopsummas; izmaiņas nonāk audita vēsturē', async ({ page }) => {
    await login(page, USERS.admin.email);
    const id = requestIds['Ilze Kalniņa'];
    await page.goto(`/pieteikumi/${id}`);
    await page.locator('#status-change').selectOption({ label: 'Atcelts' });
    await page.getByRole('button', { name: 'Mainīt statusu' }).click();
    await expect(page.getByText('Statuss nomainīts')).toBeVisible();
    await page.goto(`/pasutijums?period=${period.id}`);
    await expect(page.getByTestId('summary-row').filter({ has: page.getByRole('button', { name: 'Bietes tvaicētas', exact: true }) }).getByTestId('total-qty')).toHaveText('2,5');
    await page.goto(`/pieteikumi/${id}`);
    await expect(page.locator('.timeline')).toContainText('Pasūtītājs Demo');
    await expect(page.locator('.timeline')).toContainText('Iesniegts → Atcelts');
    await page.locator('#status-change').selectOption({ label: 'Iesniegts' });
    await page.getByRole('button', { name: 'Mainīt statusu' }).click();
    await expect(page.getByText('Statuss nomainīts')).toBeVisible();
    await page.goto(`/pasutijums?period=${period.id}`);
    await expect(page.getByTestId('summary-row').filter({ has: page.getByRole('button', { name: 'Bietes tvaicētas', exact: true }) }).getByTestId('total-qty')).toHaveText('4,0');
  });

  test('administrators var labot pieteikumu; summa un vēsture atjaunojas', async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto(`/pieteikumi/${requestIds['Jānis Bērziņš']}`);
    await expect(page.getByTestId('request-editor')).toBeVisible();
    const qty = page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/);
    await qty.fill('2,25');
    await page.getByTestId('save-changes').click();
    await expect(page.getByTestId('save-status')).toContainText('Saglabāts');
    await page.goto(`/pasutijums?period=${period.id}`);
    await expect(page.getByTestId('summary-row').filter({ has: page.getByRole('button', { name: 'Bietes tvaicētas', exact: true }) }).getByTestId('total-qty')).toHaveText('4,25');
    await page.goto(`/pieteikumi/${requestIds['Jānis Bērziņš']}`);
    await expect(page.locator('.timeline')).toContainText('mainīta rinda «Bietes tvaicētas»: daudzums 2,0 → 2,25');
    // atjauno
    await page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/).fill('2');
    await page.getByTestId('save-changes').click();
    await expect(page.getByTestId('save-status')).toContainText('Saglabāts');
  });

  test('perioda darbplūsma: iekļaut pasūtījumā -> pasūtīts; pedagogs vairs nevar labot', async ({ page, browser }) => {
    await login(page, USERS.admin.email);
    await page.goto(`/pasutijums?period=${period.id}`);
    await page.getByRole('button', { name: 'Iekļaut pasūtījumā' }).click();
    await page.getByRole('button', { name: 'Jā, iekļaut' }).click();
    await expect(page).toHaveURL(/ok=saved/);
    await expect(page.locator('.badge').filter({ hasText: 'Apkopošanā' })).toBeVisible();
    // kopsumma nemainās
    await expect(page.getByTestId('summary-row').filter({ has: page.getByRole('button', { name: 'Bietes tvaicētas', exact: true }) }).getByTestId('total-qty')).toHaveText('4,0');
    await page.getByRole('button', { name: 'Atzīmēt kā pasūtītu' }).click();
    await page.getByRole('button', { name: 'Jā, pasūtīts' }).click();
    await expect(page.locator('.badge').filter({ hasText: 'Pasūtīts' }).first()).toBeVisible();
    await page.goto(`/pieteikumi?period=${period.id}`);
    await expect(page.getByRole('row').filter({ hasText: `Apkopojums ${stamp}` }).filter({ hasText: 'Pasūtīts' })).toHaveCount(3);
    // pedagogs redz tikai lasāmu skatu
    await asUser(browser, USERS.sanita.email, async (p) => {
      await p.goto(`/pieteikumi/${requestIds['Sanita Reinfelde']}`);
      await expect(p.getByTestId('request-view')).toBeVisible();
      await expect(p.getByTestId('request-editor')).toHaveCount(0);
      await expect(p.getByText('vairs nevar labot')).toBeVisible();
    });
  });

  test('sākumlapas KPI un audita vēsture', async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto('/');
    await expect(page.getByText('Aktīvais periods')).toBeVisible();
    await expect(page.getByLabel('Rādītāji aktīvajam periodam')).toBeVisible();
    for (const label of ['Iesniegti pieteikumi', 'Pedagogi, kas iesnieguši', 'Unikālas preces pasūtījumā', 'Neapstiprinātas jaunas preces', 'Pieteikumi melnrakstā', 'Pasūtījumā iekļautās pozīcijas']) {
      await expect(page.getByText(label)).toBeVisible();
    }
    await page.screenshot({ path: 'e2e/.tmp/shots/12-admin-dashboard.png', fullPage: true });
    await page.goto('/parskati/audits');
    await expect(page.getByRole('table', { name: 'Audita vēsture' })).toContainText('Pasūtītājs Demo');
    await expect(page.getByRole('table', { name: 'Audita vēsture' })).toContainText('statuss mainīts');
  });

  test('pārskati pa pedagogiem / grupām / datumiem / kategorijām', async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto(`/parskati?period=${period.id}&dim=teacher&status=ordered`);
    await expect(page.getByRole('table', { name: /Pārskats pa pedagogiem/ })).toContainText('Ilze Kalniņa');
    await page.goto(`/parskati?period=${period.id}&dim=group&status=ordered`);
    await expect(page.getByRole('table', { name: /Pārskats pa grupām/ })).toContainText('2. grupa');
    await page.goto(`/parskati?period=${period.id}&dim=category&status=ordered`);
    await expect(page.getByRole('table', { name: /Pārskats pa kategorijām/ })).toContainText('Piena produkti');
    await page.goto(`/parskati?period=${period.id}&dim=date&status=ordered`);
    await expect(page.getByRole('table', { name: /Pārskats pa datumiem/ })).toContainText('4,0');
  });
});

test.describe('Masveida darbības un liels pieteikums', () => {
  test('masveida statusa maiņa pieteikumu sarakstā', async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto(`/pieteikumi?period=${period.id}`);
    const rows = page.getByRole('row').filter({ hasText: `Apkopojums ${stamp}` });
    await expect(rows).toHaveCount(3);
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(1).getByRole('checkbox').check();
    await page.locator('#bulk-status').selectOption({ label: 'Apstiprināts' });
    await page.getByRole('button', { name: 'Mainīt statusu' }).click();
    await expect(page.getByText('Statuss nomainīts 2 pieteikumiem')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: `Apkopojums ${stamp}` }).filter({ hasText: 'Apstiprināts' })).toHaveCount(2);
    await expect(page.getByRole('row').filter({ hasText: `Apkopojums ${stamp}` }).filter({ hasText: 'Pasūtīts' })).toHaveCount(1);
  });

  test('liels pieteikums: 150 rindas ielādējas un ir labojamas (veiktspēja)', async ({ browser }) => {
    const sb = service();
    const teacher = await sb.from('profiles').select('id').eq('email', USERS.ilze.email).single();
    const p = await createPeriod(`E2E liels ${stamp}`);
    const { data: prods } = await sb.from('products').select('id, order_unit_id').eq('is_active', true).eq('approval_status', 'approved').order('name').limit(55);
    const req = await sb.from('requests').insert({ teacher_id: teacher.data!.id, period_id: p.id, topic: `Liels pieteikums ${stamp}`, lesson_date: p.date, status: 'draft' }).select('id').single();
    const items = Array.from({ length: 150 }, (_, i) => ({ request_id: req.data!.id, position: i + 1, product_id: prods![i % prods!.length].id, unit_id: prods![i % prods!.length].order_unit_id, quantity: String(i + 1) }));
    const ins = await sb.from('request_items').insert(items);
    expect(ins.error).toBeNull();
    await asUser(browser, USERS.ilze.email, async (page) => {
      const t0 = Date.now();
      await page.goto(`/pieteikumi/${req.data!.id}`);
      await expect(page.getByTestId('item-row')).toHaveCount(150);
      const loadMs = Date.now() - t0;
      expect(loadMs).toBeLessThan(6000);
      // rakstīšana pēdējā rindā paliek ātra
      const last = page.getByTestId('item-row').nth(149).getByLabel(/^Daudzums/);
      const t1 = Date.now();
      await last.fill('7,25');
      await last.press('Enter');
      expect(Date.now() - t1).toBeLessThan(3000);
      await page.getByTestId('save-draft').click();
      await expect(page.getByTestId('save-status')).toContainText('saglabāts');
      await page.reload();
      await expect(page.getByTestId('item-row')).toHaveCount(150);
      await expect(page.getByTestId('item-row').nth(149).getByLabel(/^Daudzums/)).toHaveValue('7,25');
      // "Pievienot rindu" pievieno tikai vienu rindu (nevis iepriekš ģenerētas tukšas rindas)
      await page.getByRole('button', { name: 'Pievienot rindu' }).click();
      await expect(page.getByTestId('item-row')).toHaveCount(151);
      console.info(`[veiktspēja] pieteikums ar 150 rindām ielādēts ${loadMs} ms`);
    });
  });
});

test.describe('Katalogs, jaunās preces, periodi, lietotāji', () => {
  test('jaunas preces plūsma: pedagogs ierosina → administrators pārdēvē un apstiprina → visi to atrod', async ({ browser }) => {
    const name = `E2E rīsu kūka ${stamp}`;
    await asUser(browser, USERS.janis.email, async (page) => {
      await page.goto('/katalogs');
      await page.getByText('Ierosināt jaunu preci').click();
      await page.locator('#np2-name').fill(name);
      await page.getByRole('button', { name: 'Ierosināt preci' }).click();
      await expect(page.locator('.alert-success')).toContainText('Prece ierosināta');
      // līdz apstiprināšanai citi pedagogi to neredz
    });
    await asUser(browser, USERS.ilze.email, async (page) => {
      const r = await page.request.get(`/api/products/search?q=${encodeURIComponent('rīsu kūka')}`);
      expect(((await r.json()) as { items: Array<{ name: string }> }).items.filter((i) => i.name.includes(String(stamp)))).toHaveLength(0);
    });
    await asUser(browser, USERS.admin.email, async (page) => {
      await page.goto('/jaunas-preces');
      const card = page.getByTestId('proposal-card').filter({ hasText: name });
      await expect(card).toBeVisible();
      await expect(card).toContainText('Jānis Bērziņš');
      await page.screenshot({ path: 'e2e/.tmp/shots/13-new-products.png', fullPage: true });
      await card.locator('input[name="name"]').fill(`${name} (pārdēvēta)`);
      await card.locator('select[name="category_id"]').selectOption({ label: 'Sausās preces' });
      await card.getByRole('button', { name: 'Apstiprināt' }).click();
      await expect(page).toHaveURL(/done=approve/);
      await expect(page.locator('.alert-success').first()).toContainText('Prece apstiprināta');
    });
    await asUser(browser, USERS.ilze.email, async (page) => {
      const r = await page.request.get(`/api/products/search?q=${encodeURIComponent('rīsu kūka')}`);
      const items = ((await r.json()) as { items: Array<{ name: string; category_name: string }> }).items;
      const hit = items.find((i) => i.name === `${name} (pārdēvēta)`);
      expect(hit?.category_name).toBe('Sausās preces');
    });
  });

  test('jaunu preci var pievienot kā sinonīmu esošai precei (apvienošana): rindas pārceļas uz pareizo preci', async ({ browser }) => {
    const wrong = `Mozarela siers ${stamp}`;
    const p2 = await createPeriod(`E2E apvienošana ${stamp}`); // atsevišķs atvērts periods (iepriekšējais jau ir «Pasūtīts»)
    let requestId = '';
    await asUser(browser, USERS.sanita.email, async (page) => {
      await page.goto('/pieteikumi/jauns');
      await page.fill('#f-topic', `Apvienošana ${stamp}`);
      await page.fill('#f-date', p2.date);
      const combo = page.getByTestId('item-row').nth(0).getByRole('combobox', { name: /^Prece/ });
      await combo.fill(wrong);
      await page.getByRole('listbox').getByRole('option', { name: /Ierosināt jaunu preci/ }).click();
      await page.getByTestId('proposal-panel').getByRole('button', { name: 'Ierosināt', exact: true }).click();
      await page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/).fill('2');
      const v = await page.locator('#f-period option', { hasText: p2.name }).first().getAttribute('value');
      await page.locator('#f-period').selectOption(v as string);
      await page.getByTestId('submit-request').click();
      await page.waitForURL(/ok=submitted/);
      requestId = /pieteikumi\/([0-9a-f-]{36})/.exec(page.url())![1];
    });
    await asUser(browser, USERS.admin.email, async (page) => {
      await page.goto('/jaunas-preces');
      const card = page.getByTestId('proposal-card').filter({ hasText: wrong });
      await card.getByText('Pievienot kā sinonīmu esošai precei').click();
      await card.getByRole('combobox', { name: /^Esošā prece/ }).fill('mozzarella');
      await page.getByRole('listbox').getByRole('option', { name: /Siers Mozzarella/ }).first().click();
      await card.getByRole('button', { name: 'Pievienot kā sinonīmu un apvienot' }).click();
      await expect(page).toHaveURL(/done=merge/);
      await expect(page.locator('.alert-success').first()).toContainText('sinonīms');
      // pieteikuma rinda tagad rāda pareizo preci
      await page.goto(`/pieteikumi/${requestId}`);
      await expect(page.getByTestId('request-editor').or(page.getByTestId('request-view'))).toBeVisible();
      await expect(page.getByTestId('item-row').first().getByRole('combobox', { name: /^Prece/ })).toHaveValue('Siers Mozzarella');
      // un vecais nosaukums ir sinonīms
      const r = await page.request.get(`/api/products/search?q=${encodeURIComponent(wrong)}`);
      const items = ((await r.json()) as { items: Array<{ name: string }> }).items;
      expect(items.map((i) => i.name)).toContain('Siers Mozzarella');
    });
  });

  test('katalogs (admin): jauna prece, sinonīms, deaktivizēšana; imports ar priekšskatījumu un konfliktiem', async ({ browser }) => {
    await asUser(browser, USERS.admin.email, async (page) => {
      // jauna prece
      const name = `E2E Kēmeru sula ${stamp}`;
      await page.goto('/katalogs');
      await page.getByText('Jauna prece katalogā').click();
      await page.locator('#pr-name').fill(name);
      await page.locator('#pr-cat').selectOption({ label: 'Citi' });
      await page.getByRole('button', { name: 'Pievienot preci' }).click();
      await expect(page).toHaveURL(/\/katalogs\/[0-9a-f-]{36}\?ok=created/);
      // dublikāts tiek noraidīts
      await page.goto('/katalogs');
      await page.getByText('Jauna prece katalogā').click();
      await page.locator('#pr-name').fill(name.toUpperCase());
      await page.getByRole('button', { name: 'Pievienot preci' }).click();
      await expect(page.locator('.alert-error')).toContainText('jau ir katalogā');
      // sinonīms
      await page.goto(`/katalogs?q=${encodeURIComponent(name)}`);
      await page.getByRole('link', { name }).click();
      await page.locator('#alias-new').fill(`Kemeru sulina ${stamp}`);
      await page.getByRole('button', { name: 'Pievienot sinonīmu' }).click();
      await expect(page.locator('.alert-success')).toContainText('Sinonīms pievienots');
      const r = await page.request.get(`/api/products/search?q=${encodeURIComponent(`kemeru sulina ${stamp}`)}`);
      expect(((await r.json()) as { items: Array<{ name: string; matched_alias: string }> }).items[0]).toMatchObject({ name, matched_alias: `Kemeru sulina ${stamp}` });
      // deaktivizēšana -> neparādās meklēšanā jauniem pieteikumiem
      await page.locator('input[name="is_active"]').uncheck();
      await page.getByRole('button', { name: 'Saglabāt izmaiņas' }).click();
      await expect(page.locator('.alert-success', { hasText: 'Izmaiņas saglabātas' })).toBeVisible();
      const r2 = await page.request.get(`/api/products/search?q=${encodeURIComponent(`kemeru sulina ${stamp}`)}`);
      expect(((await r2.json()) as { items: Array<{ name: string }> }).items.map((i) => i.name)).not.toContain(name);

      // imports
      const csv = ['Preces nosaukums;Mērvienība;Kategorija;Iepakojums;Piezīme', 'Bietes;kg;Augļi un dārzeņi;;jau eksistē', 'Sviests 1×0,25 kg;gab.;Piena produkti;1×0,25 kg;', `E2E Importa prece ${stamp};kg;Sausās preces;500 g;jauna`, 'Slikta rinda;nezināmā vienība;Citi;;', `E2E Importa prece ${stamp};kg;;;dublikāts failā`].join('\n');
      const file = path.resolve('e2e/.tmp/import.csv');
      fs.writeFileSync(file, csv, 'utf8');
      await page.goto('/katalogs/imports');
      await page.setInputFiles('#imp-file', file);
      await page.getByRole('button', { name: 'Nolasīt un parādīt priekšskatījumu' }).click();
      await expect(page.getByRole('heading', { name: /Priekšskatījums/ })).toBeVisible();
      const table = page.getByRole('table', { name: 'Importa priekšskatījums' });
      await expect(table.getByRole('row').filter({ hasText: 'jau ir katalogā' })).toContainText('Bietes');
      await expect(table.getByRole('row').filter({ hasText: 'līdzīga prece' })).toContainText('Sviests 1×0,25 kg');
      await expect(table.getByRole('row').filter({ hasText: 'Nezināma mērvienība' })).toContainText('Slikta rinda');
      await expect(table.getByRole('row').filter({ hasText: 'dublikāts failā' }).last()).toBeVisible();
      await page.screenshot({ path: 'e2e/.tmp/shots/14-import-preview.png', fullPage: true });
      // līdzīgo (Sviests 1×0,25 kg) atstājam atzīmētu — tā ir cita prece
      await page.getByRole('button', { name: /Importēt izvēlētās/ }).click();
      await expect(page.locator('.alert-success')).toContainText('Imports pabeigts');
      await expect(page.locator('.alert-success')).toContainText('pievienotas 2 preces');
      await page.goto(`/katalogs?q=${encodeURIComponent(`Importa prece ${stamp}`)}`);
      await expect(page.getByRole('row').filter({ hasText: `E2E Importa prece ${stamp}` })).toHaveCount(1);
      await page.goto('/katalogs?q=sviests');
      await expect(page.getByRole('row').filter({ hasText: 'Sviests 1×0,25 kg' })).toHaveCount(1);
      await expect(page.getByRole('row').filter({ hasText: 'Sviests 1×0,2 kg' })).toHaveCount(1);
      await expect(page.getByRole('row').filter({ hasText: 'Sviests 1×0,5 kg' })).toHaveCount(1);
    });
  });

  test('sinonīma pāradresēšana uz citu preci', async ({ browser }) => {
    const alias = `Krūtiņa ${stamp}`;
    await asUser(browser, USERS.admin.email, async (page) => {
      await page.goto('/katalogs?q=vistas fileja');
      await page.getByRole('link', { name: 'Vistas fileja', exact: true }).click();
      await page.locator('#alias-new').fill(alias);
      await page.getByRole('button', { name: 'Pievienot sinonīmu' }).click();
      await expect(page.locator('.alert-success')).toContainText('Sinonīms pievienots');
      await page.getByText('Pāradresēt uz citu preci').first().click();
      await page.getByRole('combobox', { name: /^Pāradresēt uz preci/ }).fill('titara');
      await page.getByRole('listbox').getByRole('option', { name: /^Tītara fileja/ }).click();
      await page.getByRole('button', { name: 'Pāradresēt', exact: true }).click();
      await expect(page).toHaveURL(/ok=saved/);
      await expect(page.locator('.alert-success', { hasText: 'Izmaiņas saglabātas' })).toBeVisible();
      const r = await page.request.get(`/api/products/search?q=${encodeURIComponent(alias)}`);
      expect(((await r.json()) as { items: Array<{ name: string }> }).items[0].name).toBe('Tītara fileja');
    });
  });

  test('periodi: administrators izveido periodu, pedagogs to redz redaktorā', async ({ browser }) => {
    const label = `E2E jauns periods ${stamp}`;
    await asUser(browser, USERS.admin.email, async (page) => {
      await page.goto('/periodi');
      await page.locator('#pn-new').fill(label);
      await page.locator('#ps-new').fill('2031-03-03');
      await page.locator('#pe-new').fill('2031-03-07');
      await page.locator('#pd-new').fill('2031-02-28T17:00');
      await page.getByRole('button', { name: 'Izveidot periodu' }).click();
      await expect(page.locator('.alert-success')).toContainText('Periods izveidots');
      await expect(page.getByRole('table', { name: 'Periodi' })).toContainText(label);
      await expect(page.getByRole('table', { name: 'Periodi' }).getByRole('row').filter({ hasText: label })).toContainText('28.02.2031. 17:00');
      // nederīgi dati
      await page.locator('#ps-new').fill('2031-03-09');
      await page.locator('#pe-new').fill('2031-03-07');
      await page.locator('#pn-new').fill('Nederīgs');
      await page.locator('#pd-new').fill('2031-02-28T17:00');
      await page.getByRole('button', { name: 'Izveidot periodu' }).click();
      await expect(page.locator('.alert-error')).toContainText('Beigu datums nedrīkst būt pirms sākuma datuma');
    });
    await asUser(browser, USERS.ilze.email, async (page) => {
      await page.goto('/pieteikumi/jauns');
      await expect(page.locator('#f-period option', { hasText: label })).toHaveCount(1);
      await page.fill('#f-date', '2031-03-04');
      await expect(page.locator('#f-period option:checked')).toContainText(label);
    });
  });

  test('sistēmas administrators: izveido lietotāju, maina lomu, deaktivizē; deaktivizēts nevar pieteikties', async ({ browser }) => {
    const email = `e2e.${stamp}@vt.test`;
    await asUser(browser, USERS.sysadmin.email, async (page) => {
      await page.goto('/lietotaji');
      await page.locator('#u-email').fill(email);
      await page.locator('#u-name').fill('E2E Jauns Pedagogs');
      await page.locator('#u-pass').fill('Ievade-Parole-2026');
      await page.getByRole('button', { name: 'Izveidot lietotāju' }).click();
      await expect(page.locator('.alert-success')).toContainText(`Lietotājs ${email} izveidots`);
      await expect(page.getByTestId('user-row').filter({ hasText: email })).toHaveCount(1);
    });
    // jaunais lietotājs var pieteikties un ir pedagogs
    const ctx = await browser.newContext({ locale: 'lv-LV' });
    const p = await ctx.newPage();
    await login(p, email, 'Ievade-Parole-2026');
    await expect(p.getByRole('heading', { name: /Sveiki, E2E/ })).toBeVisible();
    await expect(p.getByRole('navigation', { name: 'Galvenā izvēlne' }).getByRole('link', { name: 'Kopējais pasūtījums' })).toHaveCount(0);
    // paroles maiņa profilā
    await p.goto('/profils');
    await p.locator('#p-pass').fill('Jauna-Parole-2027');
    await p.locator('#p-pass2').fill('Jauna-Parole-2027');
    await p.getByRole('button', { name: 'Nomainīt paroli' }).click();
    await expect(p.locator('.alert-success')).toContainText('Parole nomainīta');
    await p.locator('#p-pass').fill('Jauna-Parole-2027');
    await p.locator('#p-pass2').fill('citaParole');
    await p.getByRole('button', { name: 'Nomainīt paroli' }).click();
    await expect(p.locator('.alert-error')).toContainText('Paroles nesakrīt');
    await ctx.close();

    await asUser(browser, USERS.sysadmin.email, async (page) => {
      await page.goto('/lietotaji');
      const row = page.getByTestId('user-row').filter({ hasText: email });
      await row.getByLabel('Loma').selectOption('admin');
      await row.getByRole('button', { name: 'Saglabāt' }).click();
      await expect(page.locator('.alert-success').first()).toContainText('Lietotājs saglabāts');
      await row.getByLabel('Loma').selectOption('teacher');
      await row.getByRole('checkbox', { name: 'Aktīvs' }).uncheck();
      await row.getByRole('button', { name: 'Saglabāt' }).click();
      await expect(page.locator('.alert-success').first()).toContainText('Lietotājs saglabāts');
    });
    const ctx2 = await browser.newContext({ locale: 'lv-LV' });
    const p2 = await ctx2.newPage();
    await p2.goto('/login');
    await p2.fill('#email', email);
    await p2.fill('#password', 'Jauna-Parole-2027');
    await p2.click('button[type=submit]');
    await expect(p2.locator('.alert-error')).toBeVisible(); // konts deaktivizēts (Auth līmenī bloķēts)
    await expect(p2).toHaveURL(/\/login/);
    await ctx2.close();
  });

  test('grupas: sistēmas administrators pievieno grupu; pasūtītājs to redz, bet nevar mainīt', async ({ browser }) => {
    const g = `E2E grupa ${stamp}`;
    await asUser(browser, USERS.sysadmin.email, async (page) => {
      await page.goto('/grupas');
      await page.locator('#g-new').fill(g);
      await page.getByRole('button', { name: 'Pievienot grupu' }).click();
      await expect(page.locator('.alert-success')).toContainText('Pievienots');
    });
    await asUser(browser, USERS.admin.email, async (page) => {
      await page.goto('/grupas');
      await expect(page.getByText(g)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Pievienot grupu' })).toHaveCount(0);
    });
  });
});

test('izeja: pēc iziešanas sesija ir beigusies un atpakaļ poga neatver datus', async ({ page }) => {
  await login(page, USERS.sanita.email, PASSWORD);
  await logout(page);
  await page.goBack();
  await page.goto('/pieteikumi');
  await expect(page).toHaveURL(/\/login/);
});
