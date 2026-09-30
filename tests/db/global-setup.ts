import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

// DB testiem nepieciešams PostgreSQL 15+ serveris (skat. README: `npm run db:local`).
// TEST_DATABASE_URL — superlietotāja savienojums, piem. postgres://postgres@127.0.0.1:54322/postgres
// Ja mainīgais nav uzstādīts, DB testi tiek izlaisti.

const root = path.resolve(__dirname, '../..');
export const TEMPLATE_DB = 'vt_template_db';

async function applyFile(client: Client, file: string) {
  const sql = fs.readFileSync(file, 'utf8');
  await client.query(sql);
}

export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    project.provide('dbAdminUrl', '');
    return;
  }
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const tplUrl = new URL(url);
  tplUrl.pathname = `/${TEMPLATE_DB}`;
  const tpl = new Client({ connectionString: tplUrl.toString() });
  await tpl.connect();
  await applyFile(tpl, path.join(root, 'tests/db/supabase-shim.sql'));
  const migDir = path.join(root, 'supabase/migrations');
  for (const f of fs.readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort()) {
    await applyFile(tpl, path.join(migDir, f));
  }
  await applyFile(tpl, path.join(root, 'supabase/seed.sql'));
  await tpl.end();

  project.provide('dbAdminUrl', url);

  return async () => {
    const a = new Client({ connectionString: url });
    await a.connect();
    await a.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
    await a.end();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbAdminUrl: string;
  }
}
