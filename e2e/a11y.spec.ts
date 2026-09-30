import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from './helpers';

// Automātiska pieejamības pārbaude (WCAG 2 A/AA): kontrasts, etiķetes, ARIA, tabulu struktūra u.c.
async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(' ')} — ${v.help}`);
  expect(summary, `${label}: nopietni pieejamības pārkāpumi`).toEqual([]);
}

test.describe('Pieejamība (axe-core)', () => {
  test('pieteikšanās un pedagoga lapas', async ({ page }) => {
    await page.goto('/login');
    await scan(page, 'login');
    await login(page, USERS.sanita.email);
    await scan(page, 'pedagoga sākums');
    await page.goto('/pieteikumi');
    await scan(page, 'mani pieteikumi');
    await page.goto('/pieteikumi/jauns');
    await page.getByTestId('item-row').nth(0).getByRole('combobox', { name: /^Prece/ }).fill('bie');
    await expect(page.getByRole('listbox')).toBeVisible();
    await scan(page, 'jauns pieteikums ar atvērtu typeahead');
    await page.getByTestId('submit-request').click();
    await expect(page.getByTestId('error-summary')).toBeVisible();
    await scan(page, 'pieteikums ar validācijas kļūdām');
    await page.goto('/katalogs?q=sviests');
    await scan(page, 'katalogs');
    await page.goto('/profils');
    await scan(page, 'profils');
  });

  test('administratora lapas', async ({ page }) => {
    await login(page, USERS.admin.email);
    for (const [path, label] of [
      ['/', 'admin sākums'],
      ['/pieteikumi', 'pieteikumi'],
      ['/pasutijums', 'kopējais pasūtījums'],
      ['/jaunas-preces', 'jaunās preces'],
      ['/periodi', 'periodi'],
      ['/parskati', 'pārskati'],
      ['/katalogs', 'katalogs (admin)'],
      ['/katalogs/imports', 'imports'],
    ] as const) {
      await page.goto(path);
      await scan(page, label);
    }
  });
});
