import { expect, test } from '@playwright/test';
import { login, logout, service, USERS, PASSWORD } from './helpers';

test.describe('Autentifikācija un lomas', () => {
  test('nepieteikts lietotājs tiek novirzīts uz pieteikšanās lapu (visas lapas un API ir slēgtas)', async ({ page, request }) => {
    for (const path of ['/', '/pieteikumi', '/pieteikumi/jauns', '/katalogs', '/pasutijums', '/lietotaji', '/profils']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole('heading', { name: 'Pieteikšanās' })).toBeVisible();
    }
    const api = await request.get('/api/products/search?q=bie');
    expect(api.status()).toBe(401);
    const exp = await request.get('/api/export/order');
    expect(exp.status()).toBe(401);
    // publiski pieejama ir tikai pieteikšanās lapa (un veselības pārbaude bez datiem)
    expect((await request.get('/api/health')).status()).toBe(200);
  });

  test('nepareizi dati dod saprotamu latvisku kļūdu, pareizi — ieiet sistēmā un iziet droši', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', USERS.sanita.email);
    await page.fill('#password', 'nepareiza-parole');
    await page.click('button[type=submit]');
    await expect(page.locator('.alert-error')).toContainText('Nepareizs e-pasts vai parole');
    await page.screenshot({ path: 'e2e/.tmp/shots/01-login-error.png' });

    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await expect(page.getByRole('heading', { name: /Sveiki, Sanita/ })).toBeVisible();
    await page.screenshot({ path: 'e2e/.tmp/shots/02-teacher-home.png' });

    // sesija saglabājas pēc atsvaidzināšanas
    await page.reload();
    await expect(page.getByRole('heading', { name: /Sveiki, Sanita/ })).toBeVisible();

    await logout(page);
    await page.goto('/pieteikumi');
    await expect(page).toHaveURL(/\/login/);
  });

  test('derīga Auth sesija bez profila neizraisa nebeidzamu novirzīšanu — sesija tiek beigta ar saprotamu paziņojumu', async ({ page }) => {
    const sb = service();
    const email = `bez-profila.${Date.now()}@vt.test`;
    const { data, error } = await sb.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    expect(error).toBeNull();
    await sb.from('profiles').delete().eq('id', data.user!.id); // profils (un loma) trūkst
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/\/login\?error=inactive/);
    await expect(page.locator('.alert-error')).toContainText('deaktivizēts');
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/); // sesija beigta, nav cikla
  });

  test('pedagogs redz tikai pedagoga izvēlni un nevar atvērt administratora lapas (server-side pārbaude)', async ({ page, request }) => {
    await login(page, USERS.sanita.email);
    const nav = page.getByRole('navigation', { name: 'Galvenā izvēlne' });
    for (const label of ['Sākums', 'Mani pieteikumi', 'Jauns pieteikums', 'Preču katalogs', 'Profils']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Kopējais pasūtījums' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Lietotāji' })).toHaveCount(0);
    for (const path of ['/pasutijums', '/jaunas-preces', '/periodi', '/parskati', '/lietotaji', '/iestatijumi', '/katalogs/imports', '/katalogs/kategorijas', '/grupas']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/\?error=forbidden/);
      await expect(page.locator('.alert-error')).toContainText('nav tiesību');
    }
    // API ar pedagoga sesiju
    const res = await page.request.get('/api/export/order');
    expect(res.status()).toBe(403);
    const lines = await page.request.get('/api/order/lines?product=3f2b1c9e-8a4d-4f6e-9b1a-2c3d4e5f6a7b');
    expect(lines.status()).toBe(403);
    void request;
  });

  test('pasūtītājs redz administratora izvēlni, bet ne sistēmas administratora sadaļas', async ({ page }) => {
    await login(page, USERS.admin.email);
    const nav = page.getByRole('navigation', { name: 'Galvenā izvēlne' });
    for (const label of ['Sākums', 'Pieteikumi', 'Kopējais pasūtījums', 'Preču katalogs', 'Jaunās preces', 'Grupas', 'Periodi', 'Pārskati']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Lietotāji' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Iestatījumi' })).toHaveCount(0);
    await page.goto('/lietotaji');
    await expect(page).toHaveURL(/\/\?error=forbidden/);
    await page.goto('/iestatijumi');
    await expect(page).toHaveURL(/\/\?error=forbidden/);
  });

  test('sistēmas administrators redz visas sadaļas', async ({ page }) => {
    await login(page, USERS.sysadmin.email);
    const nav = page.getByRole('navigation', { name: 'Galvenā izvēlne' });
    for (const label of ['Lietotāji', 'Iestatījumi', 'Kopējais pasūtījums']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await page.goto('/lietotaji');
    await expect(page.getByRole('heading', { name: 'Lietotāji', exact: true })).toBeVisible();
  });
});
