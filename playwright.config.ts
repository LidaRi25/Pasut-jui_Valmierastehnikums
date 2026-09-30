import { defineConfig } from '@playwright/test';

// E2E testi darbojas pret īstu lietotni (next start) un Supabase-saderīgu steku (Postgres + GoTrue + PostgREST).
// Sagatavošana: skat. README, sadaļa "Testēšana" (npm run e2e:prepare).
// PW_CHROMIUM — ceļš uz Chromium, ja nav uzstādīts Playwright pārlūks.
const port = process.env.E2E_PORT ?? '3100';

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e/.tmp/results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'lv-LV',
    timezoneId: 'Europe/Riga',
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1360, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: `node --env-file=e2e/.tmp/env ./node_modules/.bin/next start -p ${port}`,
        url: `http://127.0.0.1:${port}/api/health`,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
