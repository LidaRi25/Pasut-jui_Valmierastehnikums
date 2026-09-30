import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from './helpers';

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: lapa nedrīkst ritināties horizontāli (pārpalikums ${overflow}px)`).toBeLessThanOrEqual(1);
}

test.describe('Telefona skats (390 px)', () => {
  test('pedagogs: pieteikšanās, izvēlne, pieteikuma aizpildīšana kartīšu skatā', async ({ page }) => {
    await page.goto('/login');
    await noHorizontalScroll(page, 'login');
    await page.screenshot({ path: 'e2e/.tmp/shots/m1-login.png' });
    await login(page, USERS.sanita.email);
    await noHorizontalScroll(page, 'sākums');
    await page.screenshot({ path: 'e2e/.tmp/shots/m2-home.png' });

    // izvēlne (burger)
    await page.getByRole('button', { name: 'Atvērt izvēlni' }).click();
    await expect(page.getByRole('navigation', { name: 'Galvenā izvēlne' }).getByRole('link', { name: 'Jauns pieteikums' })).toBeVisible();
    await page.screenshot({ path: 'e2e/.tmp/shots/m3-menu.png' });
    await page.getByRole('navigation', { name: 'Galvenā izvēlne' }).getByRole('link', { name: 'Jauns pieteikums' }).click();
    await expect(page).toHaveURL(/\/pieteikumi\/jauns/);
    await noHorizontalScroll(page, 'jauns pieteikums');

    // preču rindas ir kartītes: nosaukums pilnā platumā, daudzums un mērvienība blakus
    await page.fill('#f-topic', 'Telefona tests');
    const row = page.getByTestId('item-row').nth(0);
    await row.getByRole('combobox', { name: /^Prece/ }).fill('bie');
    await page.getByRole('listbox').getByRole('option', { name: /^Bietes tvaicētas/ }).tap();
    const qty = row.getByLabel(/^Daudzums/);
    await expect(qty).toBeFocused();
    await qty.fill('0,5');
    const box = await qty.boundingBox();
    expect(box!.width).toBeGreaterThan(90);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    const prod = await row.getByRole('combobox', { name: /^Prece/ }).boundingBox();
    expect(prod!.width).toBeGreaterThan(200);
    await page.getByRole('button', { name: 'Pievienot rindu' }).tap();
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    await noHorizontalScroll(page, 'pieteikums ar rindām');
    await page.screenshot({ path: 'e2e/.tmp/shots/m4-editor.png', fullPage: true });

    for (const path of ['/pieteikumi', '/katalogs?q=sviests', '/profils']) {
      await page.goto(path);
      await noHorizontalScroll(page, path);
    }
    await page.goto('/pieteikumi');
    await page.screenshot({ path: 'e2e/.tmp/shots/m5-list.png', fullPage: true });
    await page.goto('/katalogs?q=sviests');
    await page.screenshot({ path: 'e2e/.tmp/shots/m6-catalog.png', fullPage: true });
  });

  test('pasūtītājs telefonā: pasūtījums, pieteikumi un pārskati ir lietojami', async ({ page }) => {
    await login(page, USERS.admin.email);
    await noHorizontalScroll(page, 'admin sākums');
    await page.screenshot({ path: 'e2e/.tmp/shots/m7-admin-home.png', fullPage: true });
    for (const path of ['/pasutijums', '/pieteikumi', '/parskati', '/jaunas-preces', '/periodi', '/katalogs']) {
      await page.goto(path);
      await noHorizontalScroll(page, path);
    }
    await page.goto('/pasutijums');
    await expect(page.getByTestId('export-excel')).toBeVisible();
    await page.screenshot({ path: 'e2e/.tmp/shots/m8-order.png', fullPage: true });
  });
});
