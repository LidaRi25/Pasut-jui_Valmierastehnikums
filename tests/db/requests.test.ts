import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseScenario, dbAvailable, expectDbError, futureIso, newDb, type TestDb } from './helpers';

describe.skipIf(!dbAvailable())('Pieteikumu noteikumi (DB)', () => {
  let db: TestDb;
  let drop: () => Promise<void>;
  let s: Awaited<ReturnType<typeof baseScenario>>;
  const base = () => ({ period_id: s.period, lesson_date: '2026-10-06', topic: 'Zupu gatavošana', student_count: 12, group_id: s.g1 });

  beforeAll(async () => {
    ({ db, drop } = await newDb());
    s = await baseScenario(db);
  });
  afterAll(async () => {
    await drop?.();
  });

  it('melnrakstu var saglabāt nepilnīgu (bez daudzuma), bet iesniegt — nē', async () => {
    const id = await db.saveRequest(s.teacherA, { topic: '' }, [{ product: 'Bietes', quantity: null }]);
    const row = await db.admin(`select status, topic from public.requests where id = $1`, [id]);
    expect(row.rows[0].status).toBe('draft');
    await expectDbError(db.as(s.teacherA, `select public.submit_request($1)`, [id]), 'VT_SUBMIT_INVALID', 'NO_TOPIC');
    await expectDbError(db.as(s.teacherA, `select public.submit_request($1)`, [id]), 'VT_SUBMIT_INVALID', 'NO_DATE');
    await expectDbError(db.as(s.teacherA, `select public.submit_request($1)`, [id]), 'VT_SUBMIT_INVALID', 'NO_PERIOD');
    await expectDbError(db.as(s.teacherA, `select public.submit_request($1)`, [id]), 'VT_SUBMIT_INVALID', 'BAD_QTY');
  });

  it('nedrīkst iesniegt bez preces rindām; daudzumam jābūt > 0', async () => {
    const empty = await db.saveRequest(s.teacherA, base(), []);
    await expectDbError(db.as(s.teacherA, `select public.submit_request($1)`, [empty]), 'VT_SUBMIT_INVALID', 'NO_ITEMS');
    const zero = await db.saveRequest(s.teacherA, base(), [{ product: 'Bietes', quantity: '0' }].slice(0, 0));
    expect(zero).toBeTruthy();
    // daudzums 0 vai negatīvs tiek noraidīts jau ar check ierobežojumu
    await expect(db.saveRequest(s.teacherA, base(), [{ product: 'Bietes', quantity: '0' }])).rejects.toThrow(/check constraint|request_items_quantity_check/);
    await expect(db.saveRequest(s.teacherA, base(), [{ product: 'Bietes', quantity: '-2' }])).rejects.toThrow(/check constraint|request_items_quantity_check/);
  });

  it('veiksmīga iesniegšana uzstāda statusu un iesniegšanas laiku; pedagogs pats nevar uzstādīt citus statusus', async () => {
    const id = await db.saveRequest(s.teacherA, base(), [{ product: 'Bietes', quantity: '1,5'.replace(',', '.') }], { submit: true });
    const r = await db.admin(`select status, submitted_at from public.requests where id = $1`, [id]);
    expect(r.rows[0].status).toBe('submitted');
    expect(r.rows[0].submitted_at).not.toBeNull();
    await expectDbError(db.as(s.teacherA, `update public.requests set status = 'approved' where id = $1`, [id]), 'VT_FORBIDDEN_STATUS');
    await expectDbError(db.as(s.teacherA, `update public.requests set status = 'ordered' where id = $1`, [id]), 'VT_FORBIDDEN_STATUS');
    await expectDbError(db.as(s.teacherA, `update public.requests set teacher_id = $2 where id = $1`, [id, s.teacherB]), 'VT_FORBIDDEN');
    await expectDbError(db.as(s.teacherA, `select public.submit_request($1)`, [id]), 'VT_ALREADY_SUBMITTED');
    // atcelt drīkst pirms termiņa
    await db.as(s.teacherA, `update public.requests set status = 'cancelled' where id = $1`, [id]);
  });

  it('termiņš: pēc iesniegšanas termiņa pedagogs nevar ne iesniegt, ne labot iesniegto pieteikumu', async () => {
    const period = await db.createPeriod('Termiņa tests', '2026-12-07', '2026-12-11', futureIso(5));
    const draft = await db.saveRequest(s.teacherA, { ...base(), period_id: period }, [{ product: 'Bietes', quantity: '1' }]);
    const id = await db.saveRequest(s.teacherA, { ...base(), period_id: period }, [{ product: 'Bietes', quantity: '1' }], { submit: true });
    // pedagogs var labot līdz termiņam
    await db.saveRequest(s.teacherA, { ...base(), period_id: period, topic: 'Labota tēma' }, [{ product: 'Bietes', quantity: '2' }], { id });
    // termiņš beidzas
    await db.admin(`update public.order_periods set submission_deadline = now() - interval '1 minute' where id = $1`, [period]);
    await expectDbError(
      db.saveRequest(s.teacherA, { ...base(), period_id: period, topic: 'Par vēlu' }, [{ product: 'Bietes', quantity: '3' }], { id }),
      'VT_LOCKED',
    );
    await expectDbError(db.as(s.teacherA, `select public.submit_request($1)`, [draft]), 'VT_SUBMIT_INVALID', 'PERIOD_CLOSED');
    const cancel = await db.as(s.teacherA, `update public.requests set status = 'cancelled' where id = $1`, [id]);
    expect(cancel.rowCount).toBe(0); // RLS: pēc termiņa iesniegtu pieteikumu pedagogs vairs neatceļ
    const still = await db.admin(`select status from public.requests where id = $1`, [id]);
    expect(still.rows[0].status).toBe('submitted');
    // administrators drīkst labot arī pēc termiņa
    const adm = await db.as(s.admin, `update public.requests set notes = 'admin labojums' where id = $1`, [id]);
    expect(adm.rowCount).toBe(1);
    const saved = await db.admin(`select topic from public.requests where id = $1`, [id]);
    expect(saved.rows[0].topic).toBe('Labota tēma');
    // slēgts periods arī nav izvēlams jauniem pieteikumiem
    await db.admin(`update public.order_periods set status = 'closed' where id = $1`, [period]);
    await expectDbError(db.saveRequest(s.teacherB, { ...base(), period_id: period }, [{ product: 'Bietes', quantity: '1' }]), 'VT_PERIOD_CLOSED');
  });

  it('iesniegts pieteikums tiek atkārtoti validēts arī pēc labošanas (tēma, datums, rindas, daudzumi)', async () => {
    const id = await db.saveRequest(s.teacherA, base(), [{ product: 'Bietes', quantity: '1' }, { product: 'Burkāni', quantity: '2' }], { submit: true });
    const state = async () => (await db.admin(`select topic, lesson_date::text as d, (select count(*)::int from public.request_items where request_id = $1) as n from public.requests where id = $1`, [id])).rows[0];
    const before = await state();
    const save = (data: Record<string, unknown>, items: unknown) =>
      db.as(s.teacherA, `select public.save_request($1, $2::jsonb, $3::jsonb)`, [id, JSON.stringify({ ...base(), ...data }), items === undefined ? null : JSON.stringify(items)]);
    await expectDbError(save({ topic: '   ' }, undefined), 'VT_SUBMIT_INVALID', 'NO_TOPIC');
    await expectDbError(save({ lesson_date: null }, undefined), 'VT_SUBMIT_INVALID', 'NO_DATE');
    await expectDbError(save({ period_id: null }, undefined), 'VT_SUBMIT_INVALID', 'NO_PERIOD');
    // visu rindu izdzēšana (atomāri — viss tiek atritināts atpakaļ)
    await expectDbError(save({}, []), 'VT_SUBMIT_INVALID', 'NO_ITEMS');
    // tieša piekļuve (kā PATCH caur PostgREST) arī nedrīkst apiet validāciju
    await expectDbError(db.as(s.teacherA, `update public.requests set topic = '' where id = $1`, [id]), 'VT_SUBMIT_INVALID', 'NO_TOPIC');
    await expectDbError(db.as(s.teacherA, `delete from public.request_items where request_id = $1`, [id]), 'VT_SUBMIT_INVALID', 'NO_ITEMS');
    await expectDbError(db.as(s.admin, `delete from public.request_items where request_id = $1`, [id]), 'VT_SUBMIT_INVALID', 'NO_ITEMS');
    await expect(db.as(s.teacherA, `update public.request_items set quantity = 0 where request_id = $1`, [id])).rejects.toThrow(/check constraint|request_items_quantity_check/);
    await expectDbError(db.as(s.teacherA, `update public.request_items set quantity = null where request_id = $1`, [id]), 'VT_BAD_QTY');
    expect(await state()).toEqual(before);
    // derīgs labojums izdodas; viena rinda ir pietiekami
    await save({ topic: 'Labota tēma' }, [{ id: (await db.admin(`select id from public.request_items where request_id = $1 order by position limit 1`, [id])).rows[0].id, product_id: await db.product('Bietes'), unit_id: await db.unit('kg'), quantity: '4' }]);
    expect((await state()).n).toBe(1);
  });

  it('save_request: NULL rindu saraksts neaiztiek rindas; optimistiskā bloķēšana atklāj konfliktu', async () => {
    const id = await db.saveRequest(s.teacherA, base(), [{ product: 'Bietes', quantity: '1' }, { product: 'Kabači', quantity: '2' }]);
    // p_items = NULL: rindas paliek
    await db.as(s.teacherA, `select public.save_request($1, $2::jsonb, null)`, [id, JSON.stringify({ ...base(), notes: 'tikai galvene' })]);
    expect((await db.admin(`select count(*)::int as n from public.request_items where request_id = $1`, [id])).rows[0].n).toBe(2);
    // divi logi: A saglabā, B mēģina saglabāt ar novecojušu versiju
    const cur = (await db.as(s.teacherA, `select public.save_request($1, $2::jsonb, null) as r`, [id, JSON.stringify({ ...base() })])).rows[0].r.updated_at as string;
    await db.as(s.teacherA, `select public.save_request($1, $2::jsonb, null)`, [id, JSON.stringify({ ...base(), notes: 'ar pareizo versiju', expected_updated_at: cur })]);
    await expectDbError(
      db.as(s.teacherA, `select public.save_request($1, $2::jsonb, null)`, [id, JSON.stringify({ ...base(), notes: 'novecojis', expected_updated_at: cur })]),
      'VT_CONFLICT',
    );
    expect((await db.admin(`select notes from public.requests where id = $1`, [id])).rows[0].notes).toBe('ar pareizo versiju');
  });

  it('7) pieteikuma kopēšana izveido jaunu melnrakstu un NEMAINA veco ierakstu', async () => {
    const orig = await db.saveRequest(
      s.teacherA,
      { ...base(), students: 'Anete Stabiņa', notes: 'Piezīme' },
      [
        { product: 'Bietes tvaicētas', quantity: '0.5', notes: 'tvaicētas' },
        { product: 'Tītara fileja', quantity: '1' },
        { product: 'Apelsīni sulai', quantity: '1' },
      ],
      { submit: true },
    );
    const snap = async () => {
      const r = await db.admin(`select to_jsonb(r) as r from public.requests r where id = $1`, [orig]);
      const i = await db.admin(`select to_jsonb(i) as i from public.request_items i where request_id = $1 order by position`, [orig]);
      return JSON.stringify([r.rows[0].r, i.rows.map((x) => x.i)]);
    };
    const before = await snap();
    const res = await db.as(s.teacherA, `select public.copy_request($1) as r`, [orig]);
    const copy = res.rows[0].r;
    expect(copy.copied).toBe(3);
    expect(copy.skipped).toBe(0);
    expect(copy.id).not.toBe(orig);
    expect(await snap()).toBe(before); // oriģināls nemainīts (arī updated_at)
    const c = await db.admin(`select status, lesson_date, topic, students, teacher_id, submitted_at from public.requests where id = $1`, [copy.id]);
    expect(c.rows[0]).toMatchObject({ status: 'draft', lesson_date: null, topic: 'Zupu gatavošana', students: 'Anete Stabiņa', teacher_id: s.teacherA, submitted_at: null });
    const items = await db.admin(`select p.name, i.quantity::text as quantity, i.position from public.request_items i join public.products p on p.id = i.product_id where request_id = $1 order by position`, [copy.id]);
    expect(items.rows.map((r) => [r.name, r.quantity])).toEqual([['Bietes tvaicētas', '0.500'], ['Tītara fileja', '1.000'], ['Apelsīni sulai', '1.000']]);
    // kopijas labošana neietekmē oriģinālu
    await db.saveRequest(s.teacherA, { ...base(), lesson_date: '2026-10-09' }, [{ product: 'Bietes tvaicētas', quantity: '9' }], { id: copy.id });
    expect(await snap()).toBe(before);
  });

  it('kopējot izlaiž preces, kuras vairs nav aktīvas', async () => {
    const orig = await db.saveRequest(s.teacherA, base(), [
      { product: 'Ķirbis', quantity: '2' }, { product: 'Pastinaks', quantity: '1' },
    ], { submit: true });
    await db.admin(`update public.products set is_active = false where name = 'Pastinaks'`);
    const res = await db.as(s.teacherA, `select public.copy_request($1) as r`, [orig]);
    expect(res.rows[0].r).toMatchObject({ copied: 1, skipped: 1 });
    await db.admin(`update public.products set is_active = true where name = 'Pastinaks'`);
  });

  it('8) neaktīvu produktu nevar izvēlēties jaunam pieteikumam, bet esošā rinda paliek saglabājama', async () => {
    const id = await db.saveRequest(s.teacherB, base(), [{ product: 'Kabači', quantity: '2' }, { product: 'Citroni', quantity: '1' }]);
    await db.admin(`update public.products set is_active = false where name = 'Kabači'`);
    // jauna rinda ar neaktīvu produktu -> kļūda
    await expectDbError(
      db.saveRequest(s.teacherB, base(), [{ product: 'Citroni', quantity: '1' }, { product: 'Kabači', quantity: '5' }], { id: undefined }),
      'VT_PRODUCT_INACTIVE',
    );
    // esošo pieteikumu ar tagad neaktīvo produktu var turpināt saglabāt (mainot tikai daudzumu citai rindai)
    const rows = await db.admin(`select id, product_id, unit_id from public.request_items where request_id = $1 order by position`, [id]);
    await db.tx(s.teacherB, async (q) => {
      await q(`select public.save_request($1, $2::jsonb, $3::jsonb)`, [
        id, JSON.stringify(base()),
        JSON.stringify(rows.rows.map((r, i) => ({ id: r.id, product_id: r.product_id, unit_id: r.unit_id, quantity: String(i + 7) }))),
      ]);
    });
    const after = await db.admin(`select quantity::text as q from public.request_items where request_id = $1 order by position`, [id]);
    expect(after.rows.map((r) => r.q)).toEqual(['7.000', '8.000']);
    // jaunu rindu ar neaktīvu produktu tieši
    const kabaci = await db.product('Kabači');
    const unit = await db.unit('kg');
    await expectDbError(
      db.as(s.teacherB, `insert into public.request_items (request_id, product_id, quantity, unit_id) values ($1,$2,1,$3)`, [id, kabaci, unit]),
      'VT_PRODUCT_INACTIVE',
    );
    // meklēšana neaktīvu neatgriež
    const found = await db.as(s.teacherB, `select name from public.search_products('kabac')`);
    expect(found.rows).toHaveLength(0);
    await db.admin(`update public.products set is_active = true where name = 'Kabači'`);
  });

  it('saglabāšana ir atomāra un pārvalda rindu kopu: pievienošana, dzēšana, kārtība, 120 rindas', async () => {
    const id = await db.saveRequest(s.teacherC, base(), [
      { product: 'Burkāni', quantity: '1' }, { product: 'Kartupeļi', quantity: '2' }, { product: 'Sīpoli', quantity: '3' },
    ]);
    const before = await db.admin(`select id, position from public.request_items where request_id = $1 order by position`, [id]);
    expect(before.rows).toHaveLength(3);
    // pārkārto, izdzēš vidējo un pievieno jaunu
    const carrot = before.rows[0].id;
    const onion = before.rows[2].id;
    const kg = await db.unit('kg');
    await db.tx(s.teacherC, async (q) => {
      await q(`select public.save_request($1, $2::jsonb, $3::jsonb)`, [
        id, JSON.stringify(base()),
        JSON.stringify([
          { id: onion, product_id: await db.product('Sīpoli'), unit_id: kg, quantity: '3' },
          { id: carrot, product_id: await db.product('Burkāni'), unit_id: kg, quantity: '1.25' },
          { product_id: await db.product('Ķiploki'), unit_id: kg, quantity: '0.1' },
          { product_id: null, unit_id: kg, quantity: '5' }, // rinda bez preces netiek saglabāta
        ]),
      ]);
    });
    const after = await db.admin(`select p.name, i.quantity::text as q, i.position from public.request_items i join public.products p on p.id = i.product_id where request_id = $1 order by position`, [id]);
    expect(after.rows.map((r) => [r.name, r.q, r.position])).toEqual([['Sīpoli', '3.000', 1], ['Burkāni', '1.250', 2], ['Ķiploki', '0.100', 3]]);
    // 120 rindas vienā pieteikumā
    const products = (await db.admin(`select id, order_unit_id from public.products where is_active order by name limit 55`)).rows;
    const many = Array.from({ length: 120 }, (_, i) => ({ product_id: products[i % products.length].id, unit_id: products[i % products.length].order_unit_id, quantity: String(i + 1) }));
    await db.tx(s.teacherC, async (q) => {
      await q(`select public.save_request($1, $2::jsonb, $3::jsonb)`, [id, JSON.stringify(base()), JSON.stringify(many)]);
    });
    const count = await db.admin(`select count(*)::int as n, max(position) as maxpos from public.request_items where request_id = $1`, [id]);
    expect(count.rows[0]).toEqual({ n: 120, maxpos: 120 });
  });

  it('melnrakstu drīkst dzēst tikai īpašnieks; iesniegtu — nē; admins — jebkuru', async () => {
    const draft = await db.saveRequest(s.teacherA, base(), [{ product: 'Bietes', quantity: '1' }]);
    const sub = await db.saveRequest(s.teacherA, base(), [{ product: 'Bietes', quantity: '1' }], { submit: true });
    expect((await db.as(s.teacherB, `delete from public.requests where id = $1`, [draft])).rowCount).toBe(0);
    expect((await db.as(s.teacherA, `delete from public.requests where id = $1`, [sub])).rowCount).toBe(0);
    expect((await db.as(s.teacherA, `delete from public.requests where id = $1`, [draft])).rowCount).toBe(1);
    expect((await db.as(s.admin, `delete from public.requests where id = $1`, [sub])).rowCount).toBe(1);
    const log = await db.as(s.admin, `select count(*)::int as n from public.audit_log where action = 'delete' and entity_type = 'requests'`);
    expect(log.rows[0].n).toBe(2);
  });

  it('kļūdaini ID vai formāts neizraisa neparedzētu piekļuvi', async () => {
    await expect(db.as(s.teacherA, `select * from public.requests where id = 'nav-uuid'`)).rejects.toThrow(/uuid/);
    await expectDbError(db.as(s.teacherA, `select public.save_request(null, '[]'::jsonb, '[]'::jsonb)`), 'VT_INVALID');
    await expectDbError(db.as(s.teacherA, `select public.save_request(null, '{}'::jsonb, '{}'::jsonb)`), 'VT_INVALID');
  });
});
