import { describe, expect, it } from 'vitest';
import { emptyRow, findDuplicates, isMeaningful, mergeDuplicateRows, toPayload, validateForm, type FormHeader, type FormItem } from '@/lib/request-form';

const header = (over: Partial<FormHeader> = {}): FormHeader => ({
  periodId: 'p1', courseId: '', groupId: '', students: '', topic: 'Zupas', lessonDate: '2026-10-06', studentCount: '12', notes: '', ...over,
});
const row = (key: string, over: Partial<FormItem> = {}): FormItem => ({
  ...emptyRow(key), productId: 'prod-' + key, productName: 'Prece ' + key, query: 'Prece ' + key,
  unitId: 'kg-id', unitCode: 'kg', defaultUnitId: 'kg-id', defaultUnitCode: 'kg', unitWarn: '50', quantity: '1', ...over,
});

describe('validateForm', () => {
  it('derīga forma bez kļūdām', () => {
    const r = validateForm(header(), [row('a')]);
    expect(r.errors).toEqual([]);
  });

  it('24) nedrīkst iesniegt bez tēmas, datuma, perioda un preces', () => {
    const r = validateForm(header({ topic: ' ', lessonDate: '', periodId: '' }), [emptyRow('x')]);
    expect(r.errors.map((e) => e.code).sort()).toEqual(['NO_DATE', 'NO_ITEMS', 'NO_PERIOD', 'NO_TOPIC']);
  });

  it('24) daudzumam jābūt > 0 un derīgam skaitlim', () => {
    for (const q of ['0', '0,0', '-1', 'abc', '', '1,2,3']) {
      const r = validateForm(header(), [row('a', { quantity: q })]);
      expect(r.errors.map((e) => e.code), q).toContain('BAD_QTY');
    }
    for (const q of ['0,5', '0.5', '1000']) {
      expect(validateForm(header(), [row('a', { quantity: q })]).errors, q).toEqual([]);
    }
  });

  it('rinda ar tekstu, bet bez izvēlētas preces ir kļūda; pilnīgi tukša rinda — tikai brīdinājums', () => {
    const noProduct = validateForm(header(), [row('a'), row('b', { productId: null, productName: '', query: 'biet' })]);
    expect(noProduct.errors.map((e) => e.code)).toContain('NO_PRODUCT');
    const empty = validateForm(header(), [row('a'), emptyRow('b')]);
    expect(empty.errors).toEqual([]);
    expect(empty.warnings.map((w) => w.code)).toContain('EMPTY_ROW');
  });

  it('brīdina par vienu un to pašu preci divreiz un piedāvā apvienot', () => {
    const items = [row('a', { productId: 'P1', productName: 'Bietes', quantity: '0,5' }), row('b', { productId: 'P1', productName: 'Bietes', quantity: '1,5' }), row('c')];
    const r = validateForm(header(), items);
    expect(r.warnings.filter((w) => w.code === 'DUPLICATE')).toHaveLength(2);
    expect(findDuplicates(items)).toHaveLength(1);
    const merged = mergeDuplicateRows(items, 'P1', 'kg-id');
    expect(merged.map((m) => m.key)).toEqual(['a', 'c']);
    expect(merged[0].quantity).toBe('2');
    expect(validateForm(header(), merged).warnings.filter((w) => w.code === 'DUPLICATE')).toHaveLength(0);
  });

  it('dažādas mērvienības nav dublikāti', () => {
    const items = [row('a', { productId: 'P1' }), row('b', { productId: 'P1', unitId: 'g-id', unitCode: 'g' })];
    expect(findDuplicates(items)).toHaveLength(0);
  });

  it('apvienošana nesummē, ja kāds daudzums nav derīgs', () => {
    const items = [row('a', { productId: 'P1', quantity: '1' }), row('b', { productId: 'P1', quantity: 'x' })];
    expect(mergeDuplicateRows(items, 'P1', 'kg-id')[0].quantity).toBe('1');
  });

  it('brīdina par neparasti lielu daudzumu un mainītu mērvienību', () => {
    const r = validateForm(header(), [row('a', { quantity: '500' }), row('b', { unitId: 'g-id', unitCode: 'g', quantity: '10' })]);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['BIG_QTY', 'UNIT_DIFFERS']));
    expect(r.errors).toEqual([]);
  });
});

describe('toPayload / autosave', () => {
  it('daudzumi tiek normalizēti (0,5 → "0.5"), rindas bez preces netiek sūtītas', () => {
    const p = toPayload(header({ studentCount: '25' }), [row('a', { quantity: '0,5' }), emptyRow('b'), row('c', { quantity: '' })]);
    expect(p.items.map((i) => [i.id, i.quantity])).toEqual([['a', '0.5'], ['c', null]]);
    expect(p.data.student_count).toBe(25);
    expect(p.data.lesson_date).toBe('2026-10-06');
  });
  it('tukši lauki kļūst par null', () => {
    const p = toPayload(header({ periodId: '', lessonDate: '', studentCount: '' }), []);
    expect(p.data).toMatchObject({ period_id: null, lesson_date: null, student_count: null, course_id: null, group_id: null });
  });
  it('autosave netiek aktivizēts tukšai formai', () => {
    expect(isMeaningful(header({ topic: '', lessonDate: '' }), [emptyRow('a')])).toBe(false);
    expect(isMeaningful(header({ topic: 'x' }), [emptyRow('a')])).toBe(true);
    expect(isMeaningful(header({ topic: '', lessonDate: '' }), [row('a')])).toBe(true);
  });
});
