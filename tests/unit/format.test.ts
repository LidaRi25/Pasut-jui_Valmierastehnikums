import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatRequestNo, localRigaToIso, timeLeft, toDateTimeLocal, todayRiga } from '@/lib/format';

describe('datumi (Europe/Riga)', () => {
  it('datums latviešu formātā', () => {
    expect(formatDate('2026-10-29')).toBe('29.10.2026.');
    expect(formatDate(null)).toBe('');
  });
  it('laiks Rīgas joslā neatkarīgi no servera joslas (vasarā UTC+3, ziemā UTC+2)', () => {
    expect(formatDateTime('2026-10-02T14:00:00Z')).toBe('02.10.2026. 17:00');
    expect(formatDateTime('2026-12-10T15:00:00Z')).toBe('10.12.2026. 17:00');
  });
  it('vietējais Rīgas laiks -> UTC un atpakaļ', () => {
    expect(localRigaToIso('2026-10-02T17:00')).toBe('2026-10-02T14:00:00.000Z');
    expect(localRigaToIso('2026-12-10T17:00')).toBe('2026-12-10T15:00:00.000Z');
    expect(toDateTimeLocal('2026-10-02T14:00:00Z')).toBe('2026-10-02T17:00');
    expect(localRigaToIso(toDateTimeLocal('2026-03-29T20:59:00Z'))).toBe('2026-03-29T20:59:00.000Z');
    expect(localRigaToIso('nav datums')).toBeNull();
  });
  it('pieteikuma numurs', () => {
    expect(formatRequestNo(123)).toBe('P-000123');
  });
  it('šodiena Rīgas laikā (pēc pusnakts pēc Rīgas, vēl vakar pēc UTC)', () => {
    expect(todayRiga(new Date('2026-10-01T21:30:00Z'))).toBe('2026-10-02');
  });
  it('atlikušais laiks', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(timeLeft('2026-10-01T09:00:00Z', now)).toBe('termiņš beidzies');
    expect(timeLeft('2026-10-01T10:45:00Z', now)).toBe('atlikušas 45 min');
    expect(timeLeft('2026-10-05T10:00:00Z', now)).toBe('atlikušas 4 dienas');
  });
});
