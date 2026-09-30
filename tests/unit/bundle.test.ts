import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — JS modulis bez tipiem
import { buildBundle } from '../../scripts/bundle-sql.mjs';

describe('supabase/setup-all.sql', () => {
  it('ir aktuāls (atbilst migrācijām un seed.sql); atjaunināt: node scripts/bundle-sql.mjs', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../../supabase/setup-all.sql'), 'utf8');
    expect(file).toBe(buildBundle());
  });
});
