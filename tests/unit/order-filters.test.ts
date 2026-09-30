import { describe, expect, it } from 'vitest';
import { parseOrderFilters, toQueryString, toRpcArgs } from '@/lib/order-filters';
import { dbErrorMessage } from '@/lib/errors';

const UUID = '3f2b1c9e-8a4d-4f6e-9b1a-2c3d4e5f6a7b';

describe('administratora filtri', () => {
  it('atpazīst derīgus parametrus un ignorē nederīgos', () => {
    const f = parseOrderFilters(new URLSearchParams({ period: UUID, from: '2026-10-05', to: '2026-13-45', teacher: 'nav-uuid', status: 'submitted,ordered,hack', topic: '  Zupas  ' }));
    expect(f).toMatchObject({ period: UUID, from: '2026-10-05', to: undefined, teacher: undefined, statuses: ['submitted', 'ordered'], topic: 'Zupas' });
  });
  it('kombinējami filtri pārvēršas RPC argumentos un atpakaļ URL', () => {
    const f = parseOrderFilters({ period: UUID, group: UUID, status: ['draft', 'submitted'] });
    const args = toRpcArgs(f);
    expect(args.p_period_id).toBe(UUID);
    expect(args.p_group_id).toBe(UUID);
    expect(args.p_statuses).toEqual(['draft', 'submitted']);
    expect(args.p_teacher_id).toBeNull();
    expect(toQueryString(f)).toBe(`?period=${UUID}&group=${UUID}&status=draft%2Csubmitted`);
  });
  it('SQL injekcijas mēģinājums tiek noraidīts jau parsēšanas posmā', () => {
    const f = parseOrderFilters({ period: "'; drop table requests; --", from: '2026-01-01; select 1' });
    expect(f.period).toBeUndefined();
    expect(f.from).toBeUndefined();
  });
});

describe('kļūdu tulkošana latviski', () => {
  it('VT_ kodi tiek pārvērsti saprotamos tekstos', () => {
    expect(dbErrorMessage({ message: 'VT_SUBMIT_INVALID', details: 'NO_TOPIC,BAD_QTY' })).toBe(
      'Norādiet praktiskās nodarbības tēmu. Visām precēm jānorāda daudzums, kas lielāks par 0.',
    );
    expect(dbErrorMessage({ message: 'VT_LOCKED' })).toMatch(/vairs nevar labot/);
    expect(dbErrorMessage({ message: 'VT_DUPLICATE_ALIAS', details: 'Siers Mozzarella' })).toMatch(/Siers Mozzarella/);
  });
  it('tehniskas angļu kļūdas netiek rādītas', () => {
    const text = dbErrorMessage({ message: 'relation "x" does not exist', code: '42P01' });
    expect(text).not.toMatch(/relation|does not exist/);
    expect(dbErrorMessage({ message: 'duplicate key value', code: '23505' })).toBe('Šāds ieraksts jau eksistē.');
    expect(dbErrorMessage({ message: 'new row violates row-level security policy', code: '42501' })).toMatch(/nav tiesību/);
  });
});
