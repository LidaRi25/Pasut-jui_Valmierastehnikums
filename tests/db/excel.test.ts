import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrderWorkbook, SHEET_NAMES } from '@/lib/excel/order-workbook';
import { baseScenario, dbAvailable, newDb, type TestDb } from './helpers';

// Excel eksports no īstiem datubāzes datiem: kopsummas un detalizācija sakrīt ar SQL apkopojumu.
describe.skipIf(!dbAvailable())('6) Excel eksports no datubāzes datiem', () => {
  let db: TestDb;
  let drop: () => Promise<void>;
  let s: Awaited<ReturnType<typeof baseScenario>>;

  beforeAll(async () => {
    ({ db, drop } = await newDb());
    s = await baseScenario(db);
    const d = (day: string, group: string) => ({ period_id: s.period, lesson_date: day, group_id: group, topic: 'Nodarbība', student_count: 10 });
    await db.saveRequest(s.teacherA, d('2026-10-06', s.g1), [{ product: 'Bietes tvaicētas', quantity: '0.5' }, { product: 'Sviests 1×0,2 kg', quantity: '3' }], { submit: true });
    await db.saveRequest(s.teacherB, d('2026-10-07', s.g2), [{ product: 'Bietes tvaicētas', quantity: '2' }], { submit: true });
    await db.saveRequest(s.teacherC, d('2026-10-08', s.g3), [{ product: 'Bietes tvaicētas', quantity: '1.5' }, { product: 'Bietes', quantity: '1' }], { submit: true });
    // cits periods — nedrīkst nokļūt eksportā
    const other = await db.createPeriod('Cits', '2026-11-02', '2026-11-06', new Date(Date.now() + 9e9).toISOString());
    await db.saveRequest(s.teacherA, { period_id: other, lesson_date: '2026-11-03', topic: 'Cits' }, [{ product: 'Bietes tvaicētas', quantity: '100' }], { submit: true });
  });
  afterAll(async () => {
    await drop?.();
  });

  it('eksports atspoguļo tieši izvēlēto periodu, ar pareizām kopsummām', async () => {
    const filt = [s.period, null, null, null, null, null, null, null, null, null];
    const call = (fn: string, extra = '') => db.as(s.admin, `select * from public.${fn}(${extra}p_period_id => $1)`, [s.period]);
    const summary = (await call('get_order_summary')).rows;
    const lines = (await call('order_lines')).rows;
    const rep = async (dim: string) => (await db.as(s.admin, `select * from public.get_order_report($1, p_period_id => $2)`, [dim, s.period])).rows;
    void filt;
    const buf = await buildOrderWorkbook({
      institution: 'Valmieras tehnikums', periodLabel: '05.10.2026.–09.10.2026.', filterLines: [], generatedAt: new Date(), generatedBy: 'Pasūtītājs',
      summary, lines, byTeacher: await rep('teacher'), byGroup: await rep('group'), byDate: await rep('date'), byCategory: await rep('category'),
      countableUnits: new Set(['gab.']),
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);

    const ws = wb.getWorksheet(SHEET_NAMES.total)!;
    const items = new Map<string, number>();
    let inTable = false;
    ws.eachRow((row) => {
      if (row.getCell(1).value === 'Npk.') {
        inTable = true;
        return;
      }
      if (inTable && typeof row.getCell(1).value === 'number') items.set(String(row.getCell(2).value), Number(row.getCell(5).value));
    });
    expect(items.get('Bietes tvaicētas')).toBe(4); // 0,5 + 2 + 1,5, bez cita perioda 100
    expect(items.get('Bietes')).toBe(1);
    expect(items.get('Sviests 1×0,2 kg')).toBe(3);
    expect(items.size).toBe(3);

    // Detalizētā lapa: rindu summa katrai precei = kopsummai
    const det = wb.getWorksheet(SHEET_NAMES.detail)!;
    const sums = new Map<string, number>();
    let started = false;
    det.eachRow((row) => {
      if (row.getCell(1).value === 'Pedagogs') {
        started = true;
        return;
      }
      if (started && row.getCell(7).value) sums.set(String(row.getCell(7).value), (sums.get(String(row.getCell(7).value)) ?? 0) + Number(row.getCell(9).value));
    });
    for (const [name, total] of items) expect(sums.get(name), name).toBe(total);
    // Kopsumma SQL pusē sakrīt ar Excel
    for (const r of summary) expect(Number(r.total_quantity)).toBe(items.get(r.product_name));
  });
});
