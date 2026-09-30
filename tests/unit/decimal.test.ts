import { describe, expect, it } from 'vitest';
import { compareDecimals, formatQuantity, fromScaled, numStr, parseDecimal, sumDecimals, toInputValue, toScaled } from '@/lib/decimal';

describe('parseDecimal', () => {
  it('3) pieņem gan 0,5, gan 0.5 un dod vienādu vērtību', () => {
    expect(parseDecimal('0,5')).toEqual({ ok: true, value: '0.5' });
    expect(parseDecimal('0.5')).toEqual({ ok: true, value: '0.5' });
    expect(parseDecimal(',5')).toEqual({ ok: true, value: '0.5' });
    expect(parseDecimal('.5')).toEqual({ ok: true, value: '0.5' });
    expect(parseDecimal('2')).toEqual({ ok: true, value: '2' });
    expect(parseDecimal('2,')).toEqual({ ok: true, value: '2' });
    expect(parseDecimal('  1 000,25 ')).toEqual({ ok: true, value: '1000.25' });
    expect(parseDecimal('3,000')).toEqual({ ok: true, value: '3' });
    expect(parseDecimal('007,50')).toEqual({ ok: true, value: '7.5' });
  });

  it('noraida nederīgus formātus', () => {
    for (const bad of ['abc', '1e3', '1,2,3', '1.234,5', '1,234.5', '--1', '0,5kg', '5%', '']) {
      expect(parseDecimal(bad).ok, bad).toBe(false);
    }
    expect(parseDecimal('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseDecimal('0,0005')).toEqual({ ok: false, reason: 'too_precise' });
    expect(parseDecimal('123456789012')).toEqual({ ok: false, reason: 'too_large' });
  });

  it('atbalsta negatīvas vērtības parsēšanai (validācija tās noraida atsevišķi)', () => {
    expect(parseDecimal('-2,5')).toEqual({ ok: true, value: '-2.5' });
    expect(parseDecimal('-0')).toEqual({ ok: true, value: '0' });
  });
});

describe('precīza summēšana (bez peldošā komata kļūdām)', () => {
  it('0,1 + 0,2 = 0,3 (JavaScript number dotu 0.30000000000000004)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3');
  });
  it('1) 0,5 + 2 + 1,5 = 4', () => {
    expect(sumDecimals(['0.5', '2', '1.5'])).toBe('4');
  });
  it('daudz mazu vērtību', () => {
    expect(sumDecimals(Array.from({ length: 1000 }, () => '0.001'))).toBe('1');
    expect(sumDecimals(Array.from({ length: 10 }, () => '0.1'))).toBe('1');
    expect(sumDecimals(['99999999999.999', '0.001'])).toBe('100000000000');
  });
  it('ignorē tukšas vērtības', () => {
    expect(sumDecimals(['1', null, undefined, '', '2,5'.replace(',', '.')])).toBe('3.5');
    expect(sumDecimals([])).toBe('0');
  });
  it('toScaled / fromScaled ir savstarpēji apgriezti', () => {
    for (const v of ['0', '0.001', '12.5', '1000', '0.999', '-3.25']) {
      expect(fromScaled(toScaled(v))).toBe(v);
    }
  });
  it('salīdzināšana', () => {
    expect(compareDecimals('0.5', '0.50')).toBe(0);
    expect(compareDecimals('0.5', '2')).toBe(-1);
    expect(compareDecimals('10', '9.999')).toBe(1);
  });
});

describe('latviešu formāts', () => {
  it('nepārtrauktas vienības: vismaz 1 zīme aiz komata', () => {
    expect(formatQuantity('0.5')).toBe('0,5');
    expect(formatQuantity('4.000')).toBe('4,0');
    expect(formatQuantity('1.125')).toBe('1,125');
    expect(formatQuantity('0.600000')).toBe('0,6');
  });
  it('skaitāmas vienības: veseli skaitļi bez decimāldaļas', () => {
    expect(formatQuantity('3.000', true)).toBe('3');
    expect(formatQuantity('0.5', true)).toBe('0,5');
  });
  it('tūkstošu atdalītājs ir nepārtraucama atstarpe', () => {
    expect(formatQuantity('1234567.5')).toBe('1 234 567,5');
  });
  it('tukšas vērtības', () => {
    expect(formatQuantity(null)).toBe('');
    expect(formatQuantity('')).toBe('');
  });
  it('ievades lauka vērtība', () => {
    expect(toInputValue('0.500')).toBe('0,5');
    expect(toInputValue('2.000')).toBe('2');
    expect(toInputValue(null)).toBe('');
  });
});

describe('DB numeric vērtības no PostgREST (JSON skaitļi)', () => {
  it('skaitļi tiek apstrādāti tāpat kā teksti', () => {
    expect(parseDecimal(0.5)).toEqual({ ok: true, value: '0.5' });
    expect(formatQuantity(4)).toBe('4,0');
    expect(formatQuantity(1.125)).toBe('1,125');
    expect(toInputValue(0.2)).toBe('0,2');
    expect(sumDecimals([0.1, 0.2, '0.7'])).toBe('1');
    expect(compareDecimals(50, '49.999')).toBe(1);
    expect(numStr(12345678901.123)).toBe('12345678901.123');
    expect(numStr(null)).toBeNull();
  });
});
