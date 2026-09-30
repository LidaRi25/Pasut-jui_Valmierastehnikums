import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ImportFileError, parseCsv, parseImportFile } from '@/lib/import/parse';

const buf = (s: string) => Buffer.from(s, 'utf8');

describe('kataloga imports: CSV', () => {
  it('nolasa galvenes, apgriež atstarpes un ignorē tukšās rindas', async () => {
    const csv = 'Preces nosaukums;Mērvienība;Kategorija;Iepakojums;Piezīme\n  Bietes  ;kg;Augļi un dārzeņi;;svaigas\n\n"Sviests 1×0,5 kg";gab.;Piena produkti;1×0,5 kg;\n';
    const r = await parseImportFile(buf(csv), 'katalogs.csv');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ name: 'Bietes', unit: 'kg', category: 'Augļi un dārzeņi', notes: 'svaigas' });
    expect(r.rows[1]).toMatchObject({ name: 'Sviests 1×0,5 kg', unit: 'gab.', packaging: '1×0,5 kg' });
  });

  it('atbalsta komatu, tabulāciju, pēdiņas ar komatu laukā un BOM', () => {
    expect(parseCsv('\uFEFFa,b\n"x, y",2\n', ',')).toEqual([['a', 'b'], ['x, y', '2']]);
    expect(parseCsv('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a;b\n"pēdiņas ""iekšā""";2', ';')).toEqual([['a', 'b'], ['pēdiņas "iekšā"', '2']]);
  });

  it('nolasa windows-1257 kodējumu (Excel "CSV ANSI")', async () => {
    const text = 'Nosaukums;Mērvienība\nĶirbis;kg\n';
    const bytes = Buffer.from([...text].map((ch) => ({ Ķ: 0xcd, ī: 0xee, ē: 0xe7, ķ: 0xed }[ch as 'Ķ'] ?? ch.charCodeAt(0))));
    const r = await parseImportFile(bytes, 'ansi.csv');
    expect(r.rows[0].name).toBe('Ķirbis');
  });

  it('norobežotājs tiek noteikts pēc galvenes rindas, arī ja faila sākumā ir virsraksts vai tukšas rindas', async () => {
    const csv = 'Preču saraksts 2026\n\nPreces nosaukums;Mērvienība;Kategorija\nSalāti, ledus;kg;Augļi un dārzeņi\n';
    const r = await parseImportFile(buf(csv), 'ar-virsrakstu.csv');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'Salāti, ledus', unit: 'kg', category: 'Augļi un dārzeņi' }); // komats nosaukumā netiek uzskatīts par atdalītāju
    const tab = await parseImportFile(buf('Nosaukums\tMērv.\nBietes\tkg'), 'tab.csv');
    expect(tab.rows[0]).toMatchObject({ name: 'Bietes', unit: 'kg' });
  });

  it('noraida failu bez nosaukuma kolonnas, neatbalstītu paplašinājumu un bināru saturu', async () => {
    await expect(parseImportFile(buf('a;b\n1;2'), 'x.csv')).rejects.toThrow(ImportFileError);
    await expect(parseImportFile(buf('x'), 'x.exe')).rejects.toThrow(/xlsx un .csv/);
    await expect(parseImportFile(Buffer.from([0x50, 0x4b, 3, 4, 0]), 'x.csv')).rejects.toThrow(/nav teksta/);
    await expect(parseImportFile(Buffer.from('abc'), 'x.xlsx')).rejects.toThrow(/nav derīgs/);
    await expect(parseImportFile(Buffer.alloc(0), 'x.csv')).rejects.toThrow(/tukšs/);
    await expect(parseImportFile(Buffer.alloc(6 * 1024 * 1024, 65), 'x.csv')).rejects.toThrow(/pārāk liels/);
  });

  it('ignorē nepazīstamas kolonnas un brīdina', async () => {
    const r = await parseImportFile(buf('Nosaukums;Krāsa\nBietes;sarkana'), 'x.csv');
    expect(r.warnings.join(' ')).toMatch(/Krāsa/);
    expect(r.warnings.join(' ')).toMatch(/Mērvienība/);
  });
});

describe('kataloga imports: XLSX', () => {
  it('nolasa Excel failu, arī formulas, rich text un skaitļus', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Katalogs');
    ws.addRow(['Nosaukums', 'Mērv.', 'Kategorija', 'Iepakojums']);
    ws.addRow(['Bietes', 'kg', 'Augļi un dārzeņi', null]);
    ws.addRow([{ richText: [{ text: 'Piens ' }, { text: '2,5%' }] }, 'gab.', null, '1×1 L']);
    ws.addRow([{ formula: 'A2', result: 'Bietes tvaicētas' }, 'kg', null, 12]);
    const out = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseImportFile(out, 'katalogs.xlsx');
    expect(r.rows.map((x) => x.name)).toEqual(['Bietes', 'Piens 2,5%', 'Bietes tvaicētas']);
    expect(r.rows[1].packaging).toBe('1×1 L');
    expect(r.rows[2].packaging).toBe('12');
  });

  it('formulu injekcijas teksti tiek saglabāti kā teksts (netiek izpildīti)', async () => {
    const r = await parseImportFile(buf('Nosaukums;Mērvienība\n=SUM(A1:A9);kg'), 'x.csv');
    expect(r.rows[0].name).toBe('=SUM(A1:A9)');
  });
});
