#!/usr/bin/env node
// Apvieno visas migrācijas un seed vienā failā supabase/setup-all.sql — to var ielīmēt Supabase "SQL Editor"
// (ja nevēlaties lietot Supabase CLI). Fails tiek ģenerēts; testi pārbauda, ka tas ir aktuāls.
//   node scripts/bundle-sql.mjs          — pārraksta supabase/setup-all.sql
//   node scripts/bundle-sql.mjs --check  — pārbauda, vai fails ir aktuāls (izmanto CI)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migDir = path.join(root, 'supabase/migrations');

export function buildBundle() {
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  const parts = [
    '-- =============================================================================',
    '-- Valmieras tehnikums — pilna datubāzes uzstādīšana vienā failā',
    '-- ĢENERĒTS FAILS (node scripts/bundle-sql.mjs). Nelabojiet to — labojiet supabase/migrations/*.sql.',
    '-- Ielīmējiet Supabase → SQL Editor un izpildiet VIENREIZ jaunā, tukšā projektā.',
    '-- =============================================================================',
    '',
  ];
  for (const f of files) {
    parts.push(`-- >>>>>>>>>> migrācija: ${f}`, fs.readFileSync(path.join(migDir, f), 'utf8').trimEnd(), '');
  }
  parts.push('-- >>>>>>>>>> sākuma dati: seed.sql', fs.readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8').trimEnd(), '');
  return parts.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = path.join(root, 'supabase/setup-all.sql');
  const content = buildBundle();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== content) {
      console.error('supabase/setup-all.sql nav aktuāls. Palaidiet: node scripts/bundle-sql.mjs');
      process.exit(1);
    }
    console.log('supabase/setup-all.sql ir aktuāls.');
  } else {
    fs.writeFileSync(target, content);
    console.log(`Ierakstīts ${path.relative(root, target)} (${content.length} simboli)`);
  }
}
