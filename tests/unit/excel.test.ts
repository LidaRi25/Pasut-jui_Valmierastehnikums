import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildOrderWorkbook, SHEET_NAMES, type WorkbookInput } from '@/lib/excel/order-workbook';
import type { OrderLine, ReportRow, SummaryRow } from '@/lib/types';

const summary: SummaryRow[] = [
  { product_id: 'p1', product_name: 'Bietes tvaicētas', category_id: 'c1', category_name: 'Augļi un dārzeņi', approval_status: 'approved', product_active: true, unit_id: 'u-kg', unit_code: 'kg', total_quantity: 4, request_count: 3, teacher_count: 3, group_names: '1. grupa, 2. grupa', equivalent_quantity: null, equivalent_unit_code: null },
  { product_id: 'p2', product_name: 'Sviests 1×0,2 kg', category_id: 'c2', category_name: 'Piena produkti', approval_status: 'approved', product_active: true, unit_id: 'u-gab', unit_code: 'gab.', total_quantity: '3.000', request_count: 1, teacher_count: 1, group_names: null, equivalent_quantity: '0.600', equivalent_unit_code: 'kg' },
  { product_id: 'p3', product_name: 'Kvinoja sarkanā', category_id: null, category_name: null, approval_status: 'pending', product_active: true, unit_id: 'u-kg', unit_code: 'kg', total_quantity: '0.5', request_count: 1, teacher_count: 1, group_names: null, equivalent_quantity: null, equivalent_unit_code: null },
];
const line = (over: Partial<OrderLine>): OrderLine => ({
  item_id: 'i', request_id: 'r', request_no: 1, request_status: 'submitted', period_id: 'per', teacher_id: 't', teacher_name: 'Sanita Reinfelde',
  course_id: null, course_name: '4. kurss', group_id: 'g', group_name: '6. grupa', students: null, topic: 'Baltic VET Skills 2026', lesson_date: '2026-10-29',
  student_count: 1, request_notes: null, product_id: 'p1', product_name: 'Bietes tvaicētas', category_id: 'c1', category_name: 'Augļi un dārzeņi',
  approval_status: 'approved', product_active: true, unit_id: 'u-kg', unit_code: 'kg', quantity: '0.5', item_notes: null, item_position: 1, ...over,
});
const lines: OrderLine[] = [
  line({ item_id: 'a', request_no: 1, quantity: 0.5 }),
  line({ item_id: 'b', request_no: 2, teacher_name: 'Jānis Bērziņš', group_name: '2. grupa', quantity: '2', lesson_date: '2026-10-27' }),
  line({ item_id: 'c', request_no: 3, teacher_name: 'Ilze Kalniņa', group_name: '3. grupa', quantity: 1.5, lesson_date: '2026-10-28', item_notes: '=SUM(A1)' }),
];
const rep = (label: string, qty: string): ReportRow => ({ group_key: label, group_label: label, product_id: 'p1', product_name: 'Bietes tvaicētas', category_name: 'Augļi un dārzeņi', unit_id: 'u-kg', unit_code: 'kg', total_quantity: qty, request_count: 1 });

const input: WorkbookInput = {
  institution: 'Valmieras tehnikums', periodLabel: '26.10.2026.–30.10.2026.', filterLines: ['Pieteikumu statusi: Iesniegts'], generatedAt: new Date('2026-10-01T10:00:00Z'), generatedBy: 'Pasūtītājs Demo',
  summary, lines, byTeacher: [rep('Ilze Kalniņa', '1.5'), rep('Jānis Bērziņš', '2'), rep('Sanita Reinfelde', '0.5')], byGroup: [rep('1. grupa', '0.5')], byDate: [rep('27.10.2026', '2')], byCategory: [rep('Augļi un dārzeņi', '4')],
  countableUnits: new Set(['gab.', 'iep.']),
};

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

describe('6) Excel eksports', () => {
  it('satur visas prasītās lapas', async () => {
    const wb = await load(await buildOrderWorkbook(input));
    expect(wb.worksheets.map((w) => w.name)).toEqual(Object.values(SHEET_NAMES));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['KOPĒJAIS PASŪTĪJUMS', 'DETALIZĒTI', 'PA PEDAGOGIEM', 'PA GRUPĀM', 'PA DATUMIEM', 'PA KATEGORIJĀM']);
  });

  it('kopējā pasūtījuma lapā ir pareizās kolonnas un kopsummas (4,0 kg bietes)', async () => {
    const wb = await load(await buildOrderWorkbook(input));
    const ws = wb.getWorksheet(SHEET_NAMES.total)!;
    let headerRow = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(1).value === 'Npk.') headerRow = n;
    });
    expect(headerRow).toBeGreaterThan(0);
    const head = (ws.getRow(headerRow).values as unknown[]).slice(1);
    expect(head).toEqual(['Npk.', 'Prece / materiāls', 'Kategorija', 'Mērvienība', 'Kopējais daudzums', 'Piezīmes']);
    const r1 = ws.getRow(headerRow + 1);
    expect(r1.getCell(1).value).toBe(1);
    expect(r1.getCell(2).value).toBe('Bietes tvaicētas');
    expect(r1.getCell(3).value).toBe('Augļi un dārzeņi');
    expect(r1.getCell(4).value).toBe('kg');
    expect(r1.getCell(5).value).toBe(4);
    expect(r1.getCell(5).numFmt).toBe('#,##0.0##');
    const r2 = ws.getRow(headerRow + 2);
    expect(r2.getCell(5).value).toBe(3);
    expect(r2.getCell(5).numFmt).toBe('#,##0'); // gab. — veseli skaitļi
    expect(String(r2.getCell(6).value)).toContain('≈ 0,6 kg');
    const r3 = ws.getRow(headerRow + 3);
    expect(r3.getCell(5).value).toBe(0.5);
    expect(String(r3.getCell(6).value)).toContain('NEAPSTIPRINĀTA PRECE');
  });

  it('detalizētā lapa sakrīt ar kopsummu: 0,5 + 2 + 1,5 = 4', async () => {
    const wb = await load(await buildOrderWorkbook(input));
    const ws = wb.getWorksheet(SHEET_NAMES.detail)!;
    let headerRow = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(1).value === 'Pedagogs') headerRow = n;
    });
    const head = (ws.getRow(headerRow).values as unknown[]).slice(1, 11);
    expect(head).toEqual(['Pedagogs', 'Grupa', 'Kurss', 'Nodarbības tēma', 'Datums', 'Audzēkņu skaits', 'Prece', 'Mērvienība', 'Daudzums', 'Piezīme']);
    let sum = 0;
    let n = 0;
    ws.eachRow((row, i) => {
      if (i > headerRow && row.getCell(7).value === 'Bietes tvaicētas') {
        sum += Number(row.getCell(9).value);
        n++;
      }
    });
    expect(n).toBe(3);
    expect(sum).toBe(4);
    expect(ws.getRow(headerRow + 1).getCell(5).value).toBeInstanceOf(Date);
    expect(ws.getRow(headerRow + 1).getCell(5).numFmt).toBe('dd.mm.yyyy');
    // formulai līdzīgs teksts ir saglabāts kā teksts, nevis formula
    const noteCell = ws.getRow(headerRow + 3).getCell(10);
    expect(noteCell.value).toBe('=SUM(A1)');
    expect(noteCell.type).toBe(ExcelJS.ValueType.String);
  });

  it('noformējums: Arial, melna galvene ar zaļu akcentu, iesaldēti paneļi, automātiskais filtrs, kolonnu platumi', async () => {
    const wb = await load(await buildOrderWorkbook(input));
    for (const ws of wb.worksheets) {
      const frozen = ws.views[0];
      expect(frozen.state).toBe('frozen');
      expect((frozen as ExcelJS.WorksheetViewFrozen).ySplit).toBeGreaterThan(0);
      expect(ws.autoFilter).toBeTruthy();
      expect(ws.getColumn(2).width).toBeGreaterThan(10);
    }
    const ws = wb.getWorksheet(SHEET_NAMES.total)!;
    let headerRow = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(1).value === 'Npk.') headerRow = n;
    });
    const h = ws.getRow(headerRow).getCell(2);
    expect(h.font?.name).toBe('Arial');
    expect(h.font?.bold).toBe(true);
    expect((h.font?.color as { argb: string }).argb).toBe('FFFFFFFF');
    expect((h.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF000000');
    expect((h.border?.bottom?.color as { argb: string }).argb).toBe('FF00AD6F');
    expect(ws.properties.tabColor?.argb).toBe('FF00AD6F');
    expect(ws.getCell('A1').value).toBe('VALMIERAS TEHNIKUMS');
  });

  it('atskaišu lapas satur grupētus datus', async () => {
    const wb = await load(await buildOrderWorkbook(input));
    const ws = wb.getWorksheet(SHEET_NAMES.teachers)!;
    const labels: string[] = [];
    ws.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string' && ['Ilze Kalniņa', 'Jānis Bērziņš', 'Sanita Reinfelde'].includes(v)) labels.push(v);
    });
    expect(labels).toEqual(['Ilze Kalniņa', 'Jānis Bērziņš', 'Sanita Reinfelde']);
  });
});
