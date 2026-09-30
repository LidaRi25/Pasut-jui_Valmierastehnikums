import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reportLines, summarizeLines, type ReportDimension } from '@/lib/order-aggregate';
import type { OrderLine } from '@/lib/types';
import { numStr } from '@/lib/decimal';
import { baseScenario, dbAvailable, newDb, type TestDb } from './helpers';

// Excel eksports aprēķina kopsavilkumus TypeScript pusē no order_lines; te pārbaudām, ka tas precīzi sakrīt ar SQL funkcijām.
describe.skipIf(!dbAvailable())('Kopsavilkumu aprēķins TypeScript = SQL (paritāte)', () => {
  let db: TestDb;
  let drop: () => Promise<void>;
  let s: Awaited<ReturnType<typeof baseScenario>>;
  let lines: OrderLine[];
  let unitCodes: Map<string, string>;

  beforeAll(async () => {
    ({ db, drop } = await newDb());
    s = await baseScenario(db);
    const d = (day: string | null, group: string | null) => ({ period_id: s.period, lesson_date: day, group_id: group, topic: 'Paritāte' });
    await db.saveRequest(s.teacherA, d('2026-10-06', s.g1), [
      { product: 'Bietes tvaicētas', quantity: '0.1' }, { product: 'Sviests 1×0,2 kg', quantity: '3' }, { product: 'Burkāni', quantity: '500', unit: 'g' }, { product: 'Burkāni', quantity: '2' },
    ], { submit: true });
    await db.saveRequest(s.teacherB, d('2026-10-07', s.g2), [
      { product: 'Bietes tvaicētas', quantity: '0.2' }, { product: 'Sviests 1×0,2 kg', quantity: '1' }, { product: 'Piens 2,5% 1×1 L', quantity: '12' }, { product: 'Olas', quantity: '30' },
    ], { submit: true });
    await db.saveRequest(s.teacherC, d('2026-10-07', null), [
      { product: 'Bietes tvaicētas', quantity: '0.7' }, { product: 'Sviests 1×0,5 kg', quantity: '2.5' }, { product: 'Olas', quantity: '10' },
    ], { submit: true });
    // neapstiprināta prece + pieteikums bez datuma nav iespējams (iesniegšana to prasa), tāpēc datuma mērogam pietiek ar iepriekšējo
    const unit = await db.unit('kg');
    const prop = (await db.as(s.teacherA, `select public.propose_product('Kvinoja paritāte', $1) as r`, [unit])).rows[0].r.id;
    await db.tx(s.teacherA, async (q) => {
      const r = await q(`select public.save_request(null, $1::jsonb, $2::jsonb) as r`, [JSON.stringify(d('2026-10-08', s.g1)), JSON.stringify([{ product_id: prop, unit_id: unit, quantity: '0.333' }])]);
      await q(`select public.submit_request($1)`, [r.rows[0].r.id]);
    });
    lines = (await db.as(s.admin, `select * from public.order_lines(p_period_id => $1)`, [s.period])).rows as OrderLine[];
    unitCodes = new Map((await db.admin(`select id, code from public.units`)).rows.map((r) => [r.id, r.code]));
  });
  afterAll(async () => {
    await drop?.();
  });

  const norm = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(numStr(v as string)) : v);

  it('kopsavilkums pa precēm sakrīt ar get_order_summary (summas, skaiti, grupas, ekvivalenti, kārtība)', async () => {
    const sql = (await db.as(s.admin, `select * from public.get_order_summary(p_period_id => $1)`, [s.period])).rows;
    const ts = summarizeLines(lines, unitCodes);
    expect(ts).toHaveLength(sql.length);
    const shape = (row: object) => {
      const r = row as Record<string, unknown>;
      return {
      product: r.product_id, unit: r.unit_id, total: norm(r.total_quantity), requests: Number(r.request_count), teachers: Number(r.teacher_count),
      groups: r.group_names ?? null, eq: r.equivalent_quantity === null ? null : norm(r.equivalent_quantity), eqUnit: r.equivalent_unit_code ?? null, approval: r.approval_status,
      };
    };
    expect(ts.map(shape)).toEqual(sql.map(shape));
    // konkrēti pārbaudāmi gadījumi
    const bietes = ts.find((r) => r.product_name === 'Bietes tvaicētas')!;
    expect(bietes.total_quantity).toBe('1'); // 0,1 + 0,2 + 0,7 — bez peldošā komata kļūdām
    expect(ts.find((r) => r.product_name === 'Sviests 1×0,2 kg')).toMatchObject({ total_quantity: '4', equivalent_quantity: '0.8', equivalent_unit_code: 'kg' });
    expect(ts.filter((r) => r.product_name === 'Burkāni').map((r) => [r.unit_code, r.total_quantity]).sort()).toEqual([['g', '500'], ['kg', '2']]);
  });

  for (const dim of ['teacher', 'group', 'course', 'date', 'category'] as ReportDimension[]) {
    it(`atskaite pa dimensiju «${dim}» sakrīt ar get_order_report`, async () => {
      const sql = (await db.as(s.admin, `select * from public.get_order_report($1, p_period_id => $2)`, [dim, s.period])).rows;
      const ts = reportLines(lines, dim);
      const shape = (row: object) => {
        const r = row as Record<string, unknown>;
        return { key: r.group_key, label: r.group_label, product: r.product_id, unit: r.unit_id, total: norm(r.total_quantity), requests: Number(r.request_count) };
      };
      const sortKey = (x: ReturnType<typeof shape>) => `${x.key}|${x.product}|${x.unit}`;
      expect(ts.map(shape).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual(sql.map(shape).sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
    });
  }
});
