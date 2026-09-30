import { expect, test } from '@playwright/test';
import { createPeriod, createRequestViaUI, login, service, USERS } from './helpers';

test.describe.configure({ mode: 'serial' });

let period: { id: string; name: string; date: string };
test.beforeAll(async () => {
  period = await createPeriod(`E2E pedagogs ${Date.now()}`);
});

test.describe('Pedagoga darbplūsma: pieteikuma aizpildīšana', () => {
  test('typeahead: meklēšana pēc fragmenta, sinonīma, bez diakritikām; tastatūras ievade un Enter navigācija', async ({ page }) => {
    await login(page, USERS.sanita.email);
    await page.goto('/pieteikumi/jauns');
    const row1 = page.getByTestId('item-row').nth(0);
    const combo = row1.getByRole('combobox', { name: /^Prece/ });

    // "bie" -> Bietes un Bietes tvaicētas (nevis viens milzīgs select)
    await combo.fill('bie');
    const opts = page.getByRole('listbox').getByRole('option');
    await expect(opts.first()).toContainText('Bietes');
    await expect(page.getByRole('listbox').getByRole('option', { name: /^Bietes tvaicētas/ })).toBeVisible();
    await expect(page.getByRole('listbox').getByRole('option', { name: /^Bietes kg/ })).toBeVisible();
    // saraksts nav apgriezts (redzams skata logā), nevis paslēpts aiz tabulas apvalka
    await expect(page.getByRole('listbox').getByRole('option').nth(1)).toBeInViewport({ ratio: 0.9 });
    await page.screenshot({ path: 'e2e/.tmp/shots/03-typeahead.png' });

    // ↓ un Enter izvēlas otro (Bietes tvaicētas); kursors pāriet uz daudzumu, mērvienība aizpildās automātiski
    await combo.press('ArrowDown');
    await combo.press('Enter');
    await expect(combo).toHaveValue('Bietes tvaicētas');
    const qty1 = row1.getByLabel(/^Daudzums/);
    await expect(qty1).toBeFocused();
    await expect(row1.getByLabel(/^Mērvienība/)).toHaveText(/kg/);
    await qty1.fill('0.5'); // punkts
    await qty1.press('Enter');
    await expect(row1.getByLabel(/^Piezīmes/)).toBeFocused();
    await row1.getByLabel(/^Piezīmes/).press('Enter'); // -> nākamā rinda (tiek izveidota)
    const row2 = page.getByTestId('item-row').nth(1);
    await expect(row2.getByRole('combobox', { name: /^Prece/ })).toBeFocused();
    await expect(page.getByTestId('item-row')).toHaveCount(2);

    // sinonīms: "mocarella" -> Siers Mozzarella
    await row2.getByRole('combobox', { name: /^Prece/ }).fill('mocarella');
    await expect(page.getByRole('listbox').getByRole('option', { name: /Siers Mozzarella/ })).toContainText('sinonīms: Mocarella');
    await row2.getByRole('combobox', { name: /^Prece/ }).press('Enter');
    await expect(row2.getByRole('combobox', { name: /^Prece/ })).toHaveValue('Siers Mozzarella');
    await row2.getByLabel(/^Daudzums/).fill('0,25'); // komats
    await row2.getByLabel(/^Daudzums/).blur();
    await expect(row2.getByLabel(/^Daudzums/)).toHaveValue('0,25');

    // bez diakritikām: "kiploki" -> Ķiploki (Escape aizver sarakstu)
    await page.getByRole('button', { name: 'Pievienot rindu' }).click();
    const row3 = page.getByTestId('item-row').nth(2);
    await row3.getByRole('combobox', { name: /^Prece/ }).fill('kiploki');
    await expect(page.getByRole('listbox').getByRole('option', { name: /^Ķiploki/ })).toBeVisible();
    await row3.getByRole('combobox', { name: /^Prece/ }).press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);

    // Nepieciešamā prece netiek pievienota, ja nav izvēlēta no saraksta -> kļūda pie iesniegšanas
    await page.getByTestId('submit-request').click();
    await expect(page.getByTestId('error-summary')).toBeVisible();
    await expect(page.getByTestId('error-summary')).toContainText('Norādiet praktiskās nodarbības tēmu');
    await expect(page.getByTestId('error-summary')).toContainText('Norādiet praktiskās nodarbības datumu');
    await expect(page.getByTestId('error-summary')).toContainText('Izvēlieties pasūtījuma periodu');
    await expect(page.getByTestId('error-summary')).toContainText('Izvēlieties preci no saraksta');
    await page.screenshot({ path: 'e2e/.tmp/shots/04-validation.png', fullPage: true });
  });

  test('validācija un brīdinājumi: nederīgs skaitlis, liels daudzums, viena prece divreiz (apvienot rindas)', async ({ page }) => {
    await login(page, USERS.sanita.email);
    await page.goto('/pieteikumi/jauns');
    const pick = async (i: number, q: string, name: RegExp, qty: string) => {
      const row = page.getByTestId('item-row').nth(i);
      await row.getByRole('combobox', { name: /^Prece/ }).fill(q);
      await page.getByRole('listbox').getByRole('option', { name }).first().click();
      await row.getByLabel(/^Daudzums/).fill(qty);
    };
    await pick(0, 'bietes tv', /^Bietes tvaicētas/, 'abc');
    await expect(page.getByTestId('item-row').nth(0)).toContainText('nav derīgs skaitlis');
    await page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/).fill('0,5');
    await expect(page.getByTestId('item-row').nth(0)).not.toContainText('nav derīgs skaitlis');

    await page.getByRole('button', { name: 'Pievienot rindu' }).click();
    await pick(1, 'bietes tv', /^Bietes tvaicētas/, '1,5');
    await expect(page.getByText(/ievadīta 2 reizes/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Apvienot rindas?' }).click();
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/)).toHaveValue('2'); // 0,5 + 1,5 = 2 (precīzi)

    await page.getByRole('button', { name: 'Pievienot rindu' }).click();
    await pick(1, 'burkani', /^Burkāni/, '500');
    await expect(page.getByTestId('item-row').nth(1)).toContainText('Neparasti liels daudzums');
    await page.screenshot({ path: 'e2e/.tmp/shots/05-warnings.png', fullPage: true });
  });

  test('autosave: melnraksts saglabājas pats un dati nepazūd pēc atsvaidzināšanas; kopēšana neaiztiek oriģinālu; druka', async ({ page }) => {
    await login(page, USERS.sanita.email);
    await page.goto('/pieteikumi/jauns');
    const topic = `Autosave tēma ${Date.now()}`;
    await page.fill('#f-topic', topic);
    await page.fill('#f-date', period.date);
    await page.fill('#f-students', 'Anete Stabiņa');
    const row = page.getByTestId('item-row').nth(0);
    await row.getByRole('combobox', { name: /^Prece/ }).fill('tomati');
    await page.getByRole('listbox').getByRole('option', { name: /^Tomāti svaigi/ }).click();
    await row.getByLabel(/^Daudzums/).fill('3,5');
    // periods atlasīts automātiski pēc datuma (vienīgais atvērtais periods, kas aptver šo datumu)
    await expect(page.locator('#f-period option:checked')).toContainText(period.name);
    // autosave (3 s) — bez spiešanas uz "Saglabāt"
    await expect(page).toHaveURL(/\/pieteikumi\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const url = page.url();
    await expect(page.locator('#f-topic')).toHaveValue(topic);

    await page.reload();
    await expect(page.locator('#f-topic')).toHaveValue(topic);
    await expect(page.locator('#f-students')).toHaveValue('Anete Stabiņa');
    await expect(page.getByTestId('item-row').nth(0).getByRole('combobox', { name: /^Prece/ })).toHaveValue('Tomāti svaigi');
    await expect(page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/)).toHaveValue('3,5');
    await expect(page.locator('#f-period option:checked')).toContainText(period.name);

    // iesniegšana
    await page.getByTestId('submit-request').click();
    await page.waitForURL(/\?ok=submitted/);
    await expect(page.locator('.alert-success')).toContainText('Pieteikums iesniegts');
    await page.screenshot({ path: 'e2e/.tmp/shots/06-submitted.png' });

    // kopēšana -> jauns melnraksts, oriģināls nemainīts
    await page.goto('/pieteikumi');
    const listRow = page.getByRole('row').filter({ hasText: topic });
    await listRow.getByRole('button', { name: /Kopēt pieteikumu/ }).click();
    await page.waitForURL(/copied=1/);
    await expect(page.locator('.alert-success')).toContainText('nokopēts kā jauns melnraksts');
    expect(page.url()).not.toBe(url);
    await expect(page.locator('#f-topic')).toHaveValue(topic);
    await expect(page.locator('#f-date')).toHaveValue(''); // datums jānorāda no jauna
    await page.fill('#f-date', period.date);
    await page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/).fill('9');
    await page.getByTestId('save-draft').click();
    await expect(page.getByTestId('save-status')).toContainText('saglabāts');
    await page.goto(url.split('?')[0]);
    await expect(page.getByTestId('request-editor').or(page.getByTestId('request-view'))).toBeVisible();
    await expect(page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/)).toHaveValue('3,5'); // oriģināls saglabāts

    // drukas skats
    await page.goto(`${url.split('?')[0]}/druka`);
    await expect(page.getByText('Vajadzīgo produktu saraksts')).toBeVisible();
    await expect(page.locator('.sheet table')).toContainText('Tomāti svaigi');
    await expect(page.locator('.sheet')).toContainText('Anete Stabiņa');
    await expect(page.locator('.sheet')).toContainText('Sanita Reinfelde');
    await page.screenshot({ path: 'e2e/.tmp/shots/07-print.png', fullPage: true });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-toolbar')).toBeHidden();
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    expect(pdf.length).toBeGreaterThan(5000);
  });

  test('rakstīšana autosave laikā netiek zaudēta (forma netiek pārmontēta pēc pirmās saglabāšanas)', async ({ page }) => {
    await login(page, USERS.ilze.email);
    await page.goto('/pieteikumi/jauns');
    const topic = page.locator('#f-topic');
    await topic.pressSequentially('AAAA');
    // pirmā automātiskā saglabāšana izveido melnrakstu un maina adresi
    await expect(page).toHaveURL(/\/pieteikumi\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    // turpinām rakstīt uzreiz pēc saglabāšanas — teksts un fokuss nedrīkst pazust
    await expect(topic).toBeFocused();
    await topic.pressSequentially('BBBB', { delay: 60 });
    await expect(topic).toHaveValue('AAAABBBB');
    await expect(topic).toBeFocused();
    // otrā automātiskā saglabāšana (3 s pēc pēdējās izmaiņas); pēc atsvaidzināšanas viss ir datubāzē
    await page.waitForTimeout(4500);
    await expect(page.getByTestId('save-status')).toContainText('Melnraksts saglabāts');
    await page.reload();
    await expect(page.locator('#f-topic')).toHaveValue('AAAABBBB');
    // tukša forma netiek saglabāta kā melnraksts: jauns pieteikums bez datiem nerada ierakstu
    await page.goto('/pieteikumi/jauns');
    await page.waitForTimeout(4500);
    await expect(page).toHaveURL(/\/pieteikumi\/jauns$/);
    await expect(page.getByTestId('save-status')).toContainText('tiks saglabāts automātiski');
  });

  test('neveiksmīga iesniegšana un atkārtots mēģinājums neveido otru melnrakstu', async ({ page }) => {
    const p2 = await createPeriod(`E2E retry ${Date.now()}`);
    const p3 = await createPeriod(`E2E retry-2 ${Date.now()}`);
    await login(page, USERS.ilze.email);
    await page.goto('/pieteikumi/jauns');
    const topic = `Atkārtota iesniegšana ${Date.now()}`;
    await page.fill('#f-topic', topic);
    await page.fill('#f-date', p2.date);
    const v2 = await page.locator('#f-period option', { hasText: p2.name }).first().getAttribute('value');
    await page.locator('#f-period').selectOption(v2 as string);
    const row = page.getByTestId('item-row').nth(0);
    await row.getByRole('combobox', { name: /^Prece/ }).fill('burkani');
    await page.getByRole('listbox').getByRole('option', { name: /^Burkāni/ }).click();
    await row.getByLabel(/^Daudzums/).fill('2');
    // periods tiek slēgts tieši pirms iesniegšanas
    await service().from('order_periods').update({ status: 'closed' }).eq('id', p2.id);
    await page.getByTestId('submit-request').click();
    await expect(page.getByTestId('error-summary')).toContainText('slēgts vai iesniegšanas termiņš ir beidzies');
    // izvēlamies citu periodu un iesniedzam vēlreiz
    const v3 = await page.locator('#f-period option', { hasText: p3.name }).first().getAttribute('value');
    await page.locator('#f-period').selectOption(v3 as string);
    await page.getByTestId('submit-request').click();
    await page.waitForURL(/ok=submitted/);
    await page.goto('/pieteikumi?status=');
    await expect(page.getByRole('row').filter({ hasText: topic })).toHaveCount(1); // nevis 2
  });

  test('iesniegta pieteikuma labošana tiek validēta: tukšu tēmu un rindu izdzēšanu nevar saglabāt', async ({ page }) => {
    const p = await createPeriod(`E2E labošana ${Date.now()}`);
    await login(page, USERS.sanita.email);
    const id = await createRequestViaUI(page, {
      topic: `Labojamais ${Date.now()}`, date: p.date, periodName: p.name,
      items: [{ search: 'kabaci', pick: /^Kabači/, qty: '3' }],
    });
    await page.goto(`/pieteikumi/${id}`);
    const topic = await page.locator('#f-topic').inputValue();
    await page.fill('#f-topic', '   ');
    await page.getByTestId('save-changes').click();
    await expect(page.getByTestId('save-status')).toContainText('Norādiet praktiskās nodarbības tēmu');
    await page.fill('#f-topic', topic);
    // izdzēšam vienīgo rindu -> tukša rinda; saglabājot serveris noraida (nav preču)
    await page.getByRole('button', { name: /^Dzēst 1\. rindu/ }).click();
    await page.getByTestId('save-changes').click();
    await expect(page.getByTestId('save-status')).toContainText('Pievienojiet vismaz vienu preci');
    await page.reload();
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(page.getByTestId('item-row').nth(0).getByRole('combobox', { name: /^Prece/ })).toHaveValue('Kabači');
  });

  test('vienu pieteikumu atverot divos logos, otrs saglabājums neuzraksta pāri klusi (konflikta atklāšana)', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'lv-LV', viewport: { width: 1360, height: 900 } });
    const a = await ctx.newPage();
    await login(a, USERS.ilze.email);
    await a.goto('/pieteikumi/jauns');
    await a.fill('#f-topic', `Konflikts ${Date.now()}`);
    await a.getByTestId('save-draft').click();
    await expect(a.getByTestId('save-status')).toContainText('saglabāts');
    const url = a.url();
    const b = await ctx.newPage();
    await b.goto(url);
    await a.fill('#f-notes', 'no loga A');
    await a.getByTestId('save-draft').click();
    await expect(a.getByTestId('save-status')).toContainText('saglabāts');
    await b.fill('#f-notes', 'no loga B');
    await b.getByTestId('save-draft').click();
    await expect(b.getByTestId('save-status')).toContainText('starplaikā ir mainīts');
    await b.reload();
    await expect(b.locator('#f-notes')).toHaveValue('no loga A'); // A izmaiņas nav pazudušas
    await ctx.close();
  });

  test('jaunas preces ierosināšana pieteikuma rindā: prece uzreiz izmantojama, atzīmēta kā neapstiprināta', async ({ page }) => {
    await login(page, USERS.ilze.email);
    await page.goto('/pieteikumi/jauns');
    const name = `Kvinoja sarkanā ${Date.now()}`;
    const combo = page.getByTestId('item-row').nth(0).getByRole('combobox', { name: /^Prece/ });
    await combo.fill(name);
    await expect(page.getByRole('listbox').getByRole('option', { name: /Katalogā nekas netika atrasts|Ierosināt jaunu preci/ }).first()).toBeVisible();
    await page.getByRole('listbox').getByRole('option', { name: /Ierosināt jaunu preci/ }).click();
    const panel = page.getByTestId('proposal-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('#np-name')).toHaveValue(name);
    await panel.getByRole('button', { name: 'Ierosināt', exact: true }).click();
    await expect(combo).toHaveValue(name);
    await expect(page.getByTestId('item-row').nth(0)).toContainText('gaida administratora apstiprinājumu');
    await expect(page.getByTestId('item-row').nth(0).getByLabel(/^Daudzums/)).toBeFocused();
    await page.screenshot({ path: 'e2e/.tmp/shots/08-proposal.png' });
    // dublikāts tiek noraidīts ar latvisku paziņojumu
    await page.getByRole('button', { name: 'Pievienot rindu' }).click();
    const combo2 = page.getByTestId('item-row').nth(1).getByRole('combobox', { name: /^Prece/ });
    await combo2.fill('bietes');
    await page.getByRole('listbox').getByRole('option', { name: /Ierosināt jaunu preci/ }).click();
    await page.getByTestId('proposal-panel').locator('#np-name').fill('Bietes');
    await page.getByTestId('proposal-panel').getByRole('button', { name: 'Ierosināt', exact: true }).click();
    await expect(page.getByTestId('proposal-panel')).toContainText('jau ir katalogā');
  });

  test('pedagogs neredz cita pedagoga pieteikumus un nevar tos atvērt pēc ID; katalogs ir tikai lasāms', async ({ page, browser }) => {
    // Sanita izveido pieteikumu
    await login(page, USERS.sanita.email);
    await page.goto('/pieteikumi');
    const own = await page.getByRole('link', { name: /P-0000\d\d/ }).first().getAttribute('href');
    expect(own).toBeTruthy();
    const ownUrl = own as string;

    // Jānis mēģina atvērt Sanitas pieteikumu, nomainot URL
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await login(other, USERS.janis.email);
    const r = await other.goto(ownUrl);
    expect(r?.status()).toBe(404);
    await expect(other.getByRole('heading', { name: 'Lapa nav atrasta' })).toBeVisible();
    await other.goto(`${ownUrl}/druka`);
    await expect(other.getByRole('heading', { name: 'Lapa nav atrasta' })).toBeVisible();
    // savu sarakstu redz tikai savus
    await other.goto('/pieteikumi');
    await expect(other.getByRole('link', { name: /Baltic VET Skills/ })).toHaveCount(0);
    await expect(other.getByText('Sanita Reinfelde')).toHaveCount(0);
    // katalogs — meklēšana serverī, bez labošanas pogām
    await other.goto('/katalogs?q=sviests');
    await expect(other.getByRole('row', { name: /Sviests 1×0,2 kg/ })).toBeVisible();
    await expect(other.getByRole('row', { name: /Sviests 1×0,5 kg/ })).toBeVisible();
    await expect(other.getByRole('link', { name: 'Labot' })).toHaveCount(0);
    await ctx.close();
  });
});
