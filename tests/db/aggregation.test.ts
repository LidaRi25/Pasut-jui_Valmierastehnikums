import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseScenario, dbAvailable, newDb, type TestDb } from './helpers';

describe.skipIf(!dbAvailable())('Kopējā pasūtījuma apkopošana (DB)', () => {
  let db: TestDb;
  let drop: () => Promise<void>;
  let s: Awaited<ReturnType<typeof baseScenario>>;

  beforeAll(async () => {
    ({ db, drop } = await newDb());
    s = await baseScenario(db);
    const d = (day: string, group: string) => ({
      period_id: s.period, lesson_date: day, group_id: group, topic: 'Praktiskā nodarbība', student_count: 12,
    });
    // Pedagogs A: Bietes tvaicētas 0,5 kg (+ parastās Bietes 1 kg, kas ir CITA prece)
    await db.saveRequest(s.teacherA, d('2026-10-06', s.g1), [
      { product: 'Bietes tvaicētas', quantity: '0,5'.replace(',', '.') },
      { product: 'Bietes', quantity: '1' },
      { product: 'Sviests 1×0,2 kg', quantity: '3' },
    ], { submit: true });
    // Pedagogs B: 2 kg
    await db.saveRequest(s.teacherB, d('2026-10-07', s.g2), [
      { product: 'Bietes tvaicētas', quantity: '2' },
      { product: 'Sviests 1×0,5 kg', quantity: '2' },
    ], { submit: true });
    // Pedagogs C: 1,5 kg
    await db.saveRequest(s.teacherC, d('2026-10-08', s.g3), [
      { product: 'Bietes tvaicētas', quantity: '1.5' },
    ], { submit: true });
  });
  afterAll(async () => {
    await drop?.();
  });

  const summary = (args: Record<string, unknown> = {}) =>
    db.as(
      s.admin,
      `select * from public.get_order_summary(p_period_id => $1, p_date_from => $2, p_date_to => $3,
         p_teacher_id => $4, p_group_id => $5, p_category_id => $6, p_statuses => $7::public.request_status[], p_topic => $8)`,
      [args.period ?? null, args.from ?? null, args.to ?? null, args.teacher ?? null, args.group ?? null,
       args.category ?? null, args.statuses ?? null, args.topic ?? null],
    );

  it('1) vienu preci no vairākiem pieteikumiem summē: 0,5 + 2 + 1,5 = 4,0 kg', async () => {
    const r = await summary({ period: s.period });
    const row = r.rows.find((x) => x.product_name === 'Bietes tvaicētas');
    expect(row).toBeDefined();
    expect(row.total_quantity).toBe('4.000');
    expect(row.unit_code).toBe('kg');
    expect(row.request_count).toBe('3');
    expect(row.teacher_count).toBe('3');
    expect(row.group_names).toBe('1. grupa, 2. grupa, 3. grupa');
  });

  it('2) dažādi product_id netiek apvienoti (Bietes ≠ Bietes tvaicētas; Sviests 0,2 ≠ Sviests 0,5)', async () => {
    const r = await summary({ period: s.period });
    const names = r.rows.map((x) => x.product_name);
    expect(names).toContain('Bietes');
    expect(names).toContain('Bietes tvaicētas');
    expect(r.rows.find((x) => x.product_name === 'Bietes').total_quantity).toBe('1.000');
    const b02 = r.rows.find((x) => x.product_name === 'Sviests 1×0,2 kg');
    const b05 = r.rows.find((x) => x.product_name === 'Sviests 1×0,5 kg');
    expect(b02.total_quantity).toBe('3.000');
    expect(b05.total_quantity).toBe('2.000');
    // iepakojuma koeficients: 3 gab. × 0,2 kg = 0,6 kg (papildu informācija; gab. netiek pārvērstas litros/kg)
    expect(b02.unit_code).toBe('gab.');
    expect(b02.equivalent_quantity).toBe('0.600');
    expect(b02.equivalent_unit_code).toBe('kg');
  });

  it('decimālsummas ir precīzas (nav peldošā komata kļūdu): 0,1 + 0,2 = 0,3', async () => {
    const t = await db.createUser('precizi@vt.test', 'Precīzais Pedagogs');
    const period = await db.createPeriod('Decimālais tests', '2026-11-02', '2026-11-06', new Date(Date.now() + 9e9).toISOString());
    for (const q of ['0.1', '0.2']) {
      await db.saveRequest(t, { period_id: period, lesson_date: '2026-11-03', topic: 'Decimāļi' },
        [{ product: 'Dilles svaigas', quantity: q }], { submit: true });
    }
    const r = await db.as(s.admin, `select * from public.get_order_summary(p_period_id => $1)`, [period]);
    expect(r.rows[0].total_quantity).toBe('0.300');
  });

  it('detalizācija: kopsumma sakrīt ar sākotnējo pieteikumu rindu summu', async () => {
    const productId = await db.product('Bietes tvaicētas');
    const r = await db.as(
      s.admin,
      `select teacher_name, group_name, lesson_date::text as lesson_date, quantity from public.order_lines(p_period_id => $1, p_product_id => $2)
       order by lesson_date`,
      [s.period, productId],
    );
    expect(r.rows.map((x) => x.teacher_name)).toEqual(['Sanita Reinfelde', 'Jānis Bērziņš', 'Ilze Kalniņa']);
    expect(r.rows.map((x) => x.quantity)).toEqual(['0.500', '2.000', '1.500']);
    const sum = await db.as(s.admin, `select sum(quantity)::text as s from public.order_lines(p_period_id => $1, p_product_id => $2)`, [s.period, productId]);
    expect(sum.rows[0].s).toBe('4.000');
  });

  it('dažādas mērvienības vienai precei netiek summētas kopā', async () => {
    const t = await db.createUser('gramos@vt.test', 'Gramu Pedagogs');
    const period = await db.createPeriod('Mērvienību tests', '2026-11-09', '2026-11-13', new Date(Date.now() + 9e9).toISOString());
    await db.saveRequest(t, { period_id: period, lesson_date: '2026-11-10', topic: 'Vienības' },
      [{ product: 'Burkāni', quantity: '2' }], { submit: true });
    await db.saveRequest(t, { period_id: period, lesson_date: '2026-11-11', topic: 'Vienības 2' },
      [{ product: 'Burkāni', quantity: '500', unit: 'g' }], { submit: true });
    const r = await db.as(s.admin, `select unit_code, total_quantity from public.get_order_summary(p_period_id => $1) order by unit_code`, [period]);
    expect(r.rows).toEqual([
      { unit_code: 'g', total_quantity: '500.000' },
      { unit_code: 'kg', total_quantity: '2.000' },
    ]);
  });

  it('10) perioda filtrs: cits periods nesajaucas', async () => {
    const t = await db.createUser('periods2@vt.test', 'Cita Perioda Pedagogs');
    const period2 = await db.createPeriod('12.10.–16.10.2026.', '2026-10-12', '2026-10-16', new Date(Date.now() + 9e9).toISOString());
    await db.saveRequest(t, { period_id: period2, lesson_date: '2026-10-13', topic: 'Cits periods' },
      [{ product: 'Bietes tvaicētas', quantity: '10' }], { submit: true });
    const p1 = await summary({ period: s.period });
    const p2 = await summary({ period: period2 });
    expect(p1.rows.find((x) => x.product_name === 'Bietes tvaicētas').total_quantity).toBe('4.000');
    expect(p2.rows).toHaveLength(1);
    expect(p2.rows[0].total_quantity).toBe('10.000');
  });

  it('filtri ir kombinējami: datums, pedagogs, grupa, kategorija, tēma', async () => {
    const onlyDay = await summary({ period: s.period, from: '2026-10-07', to: '2026-10-07' });
    expect(onlyDay.rows.map((x) => x.product_name).sort()).toEqual(['Bietes tvaicētas', 'Sviests 1×0,5 kg']);
    expect(onlyDay.rows.find((x) => x.product_name === 'Bietes tvaicētas').total_quantity).toBe('2.000');

    const byTeacher = await summary({ period: s.period, teacher: s.teacherA });
    expect(byTeacher.rows.find((x) => x.product_name === 'Bietes tvaicētas').total_quantity).toBe('0.500');

    const byGroup = await summary({ period: s.period, group: s.g3 });
    expect(byGroup.rows).toHaveLength(1);
    expect(byGroup.rows[0].total_quantity).toBe('1.500');

    const dairy = await db.id('product_categories', 'name', 'Piena produkti');
    const byCat = await summary({ period: s.period, category: dairy });
    expect(byCat.rows.map((x) => x.product_name).sort()).toEqual(['Sviests 1×0,2 kg', 'Sviests 1×0,5 kg']);

    const byTopic = await summary({ period: s.period, topic: 'PRAKTISKA' }); // bez reģistrjutības un diakritikām
    expect(byTopic.rows.length).toBeGreaterThan(0);
    const none = await summary({ period: s.period, topic: 'nav tādas tēmas' });
    expect(none.rows).toHaveLength(0);
  });

  it('melnraksti un atceltie pieteikumi netiek iekļauti kopsummā; statusu filtrs strādā', async () => {
    const t = await db.createUser('melnraksts@vt.test', 'Melnraksta Pedagogs');
    const period = await db.createPeriod('Statusu tests', '2026-11-16', '2026-11-20', new Date(Date.now() + 9e9).toISOString());
    const dataOf = (d: string) => ({ period_id: period, lesson_date: d, topic: 'Statusi' });
    await db.saveRequest(t, dataOf('2026-11-17'), [{ product: 'Kabači', quantity: '5' }]); // melnraksts
    const sub = await db.saveRequest(t, dataOf('2026-11-18'), [{ product: 'Kabači', quantity: '7' }], { submit: true });
    const cancelled = await db.saveRequest(t, dataOf('2026-11-19'), [{ product: 'Kabači', quantity: '11' }], { submit: true });
    await db.as(s.admin, `update public.requests set status = 'cancelled' where id = $1`, [cancelled]);

    let r = await db.as(s.admin, `select total_quantity from public.get_order_summary(p_period_id => $1)`, [period]);
    expect(r.rows).toEqual([{ total_quantity: '7.000' }]);

    await db.as(s.admin, `update public.requests set status = 'included' where id = $1`, [sub]);
    r = await db.as(s.admin, `select total_quantity from public.get_order_summary(p_period_id => $1)`, [period]);
    expect(r.rows).toEqual([{ total_quantity: '7.000' }]); // iekļautie arī tiek skaitīti

    // statusu filtrs: skaidri pieprasot melnrakstus, tie parādās (pēc noklusējuma — nē)
    r = await db.as(s.admin, `select total_quantity from public.get_order_summary(p_period_id => $1, p_statuses => '{draft}')`, [period]);
    expect(r.rows).toEqual([{ total_quantity: '5.000' }]);
    r = await db.as(s.admin, `select total_quantity from public.get_order_summary(p_period_id => $1, p_statuses => '{cancelled}')`, [period]);
    expect(r.rows).toEqual([{ total_quantity: '11.000' }]);
  });

  it('atskaites pa pedagogiem / grupām / datumiem / kategorijām', async () => {
    const byTeacher = await db.as(s.admin, `select group_label, product_name, total_quantity from public.get_order_report('teacher', p_period_id => $1) where product_name = 'Bietes tvaicētas' order by group_label`, [s.period]);
    expect(byTeacher.rows.map((r) => [r.group_label, r.total_quantity])).toEqual([
      ['Ilze Kalniņa', '1.500'], ['Jānis Bērziņš', '2.000'], ['Sanita Reinfelde', '0.500'],
    ]);
    const byDate = await db.as(s.admin, `select group_label, total_quantity from public.get_order_report('date', p_period_id => $1) where product_name = 'Bietes tvaicētas' order by group_key`, [s.period]);
    expect(byDate.rows.map((r) => [r.group_label, r.total_quantity])).toEqual([
      ['06.10.2026', '0.500'], ['07.10.2026', '2.000'], ['08.10.2026', '1.500'],
    ]);
    const byGroup = await db.as(s.admin, `select group_label from public.get_order_report('group', p_period_id => $1) group by group_label order by group_label`, [s.period]);
    expect(byGroup.rows.map((r) => r.group_label)).toEqual(['1. grupa', '2. grupa', '3. grupa']);
    const byCat = await db.as(s.admin, `select distinct group_label from public.get_order_report('category', p_period_id => $1) order by 1`, [s.period]);
    expect(byCat.rows.map((r) => r.group_label)).toEqual(['Augļi un dārzeņi', 'Piena produkti']);
  });

  it('KPI: dashboard_stats', async () => {
    const r = await db.as(s.admin, `select public.dashboard_stats($1) as st`, [s.period]);
    expect(r.rows[0].st).toMatchObject({
      submitted_requests: 3, submitted_teachers: 3, unique_products: 4, included_positions: 0,
    });
  });
});
