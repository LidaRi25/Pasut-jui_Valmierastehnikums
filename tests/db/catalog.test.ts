import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseScenario, dbAvailable, expectDbError, newDb, type TestDb } from './helpers';

describe.skipIf(!dbAvailable())('Produktu katalogs, sinonīmi, ierosinājumi (DB)', () => {
  let db: TestDb;
  let drop: () => Promise<void>;
  let s: Awaited<ReturnType<typeof baseScenario>>;
  const search = async (as: string, q: string) =>
    (await db.as(as, `select name, matched_alias from public.search_products($1)`, [q])).rows;

  beforeAll(async () => {
    ({ db, drop } = await newDb());
    s = await baseScenario(db);
  });
  afterAll(async () => {
    await drop?.();
  });

  it('meklēšana: fragments, bez reģistrjutības, bez diakritikām', async () => {
    expect((await search(s.teacherA, 'bie')).map((r) => r.name)).toEqual(['Bietes', 'Bietes tvaicētas']);
    expect((await search(s.teacherA, 'BIE')).map((r) => r.name)).toEqual(['Bietes', 'Bietes tvaicētas']);
    expect((await search(s.teacherA, 'kiploki')).map((r) => r.name)).toEqual(['Ķiploki']);
    expect((await search(s.teacherA, 'ĶIPL')).map((r) => r.name)).toEqual(['Ķiploki']);
    expect((await search(s.teacherA, 'tvaic biet')).map((r) => r.name)).toEqual(['Bietes tvaicētas']);
    expect((await search(s.teacherA, 'sviests 1x0.2')).map((r) => r.name)).toEqual(['Sviests 1×0,2 kg']);
    expect(await search(s.teacherA, '')).toEqual([]);
    expect(await search(s.teacherA, "'; drop table products; --")).toEqual([]);
    const still = await db.admin(`select count(*)::int as n from public.products`);
    expect(still.rows[0].n).toBeGreaterThan(50);
  });

  it('9) alias meklēšana: Mocarella / Mozarella -> Siers Mozzarella', async () => {
    for (const q of ['Mocarella', 'mozarella', 'Mozzarella']) {
      const r = await search(s.teacherA, q);
      expect(r.map((x) => x.name)).toEqual(['Siers Mozzarella']);
    }
    const viaAlias = await search(s.teacherA, 'Mocarella');
    expect(viaAlias[0].matched_alias).toBe('Mocarella');
    // alias pats neveido jaunu preci un nevienu neapvieno
    const n = await db.admin(`select count(*)::int as n from public.products where name ilike '%mozz%' or name ilike '%mocar%'`);
    expect(n.rows[0].n).toBe(1);
  });

  it('administrators var pievienot alias un pāradresēt to uz citu preci', async () => {
    const pid = await db.product('Vistas fileja');
    const other = await db.product('Tītara fileja');
    const ins = await db.as(s.admin, `insert into public.product_aliases (product_id, alias) values ($1, 'Vistu krūtiņa') returning id`, [pid]);
    expect((await search(s.teacherA, 'krūtiņa')).map((r) => r.name)).toEqual(['Vistas fileja']);
    await db.as(s.admin, `update public.product_aliases set product_id = $1 where id = $2`, [other, ins.rows[0].id]);
    expect((await search(s.teacherA, 'krūtiņa')).map((r) => r.name)).toEqual(['Tītara fileja']);
    await expect(db.as(s.teacherA, `insert into public.product_aliases (product_id, alias) values ($1, 'x')`, [pid])).rejects.toThrow(/row-level security/);
    await expect(db.as(s.admin, `insert into public.product_aliases (product_id, alias) values ($1, 'vistu KRŪTIŅA')`, [pid])).rejects.toThrow(/duplicate key/);
  });

  it('dažādi produkti ar līdzīgiem nosaukumiem ir atļauti; identisks normalizētais nosaukums — nē', async () => {
    const names = await db.admin(`select name from public.products where name like 'Sviests%' order by name`);
    expect(names.rows.map((r) => r.name)).toEqual(['Sviests 1×0,2 kg', 'Sviests 1×0,5 kg']);
    const unit = await db.unit('kg');
    await expect(db.as(s.admin, `insert into public.products (name, base_unit_id, order_unit_id) values ('  BIETES  ', $1, $1)`, [unit])).rejects.toThrow(/products_name_unique/);
    await expect(db.as(s.admin, `insert into public.products (name, base_unit_id, order_unit_id) values ('Sviests 1x0,2 kg', $1, $1)`, [unit])).rejects.toThrow(/products_name_unique/);
    // oriģinālais nosaukums netiek bojāts, tikai kārtots un normalizēts meklēšanai
    const ok = await db.as(s.admin, `insert into public.products (name, base_unit_id, order_unit_id) values ('  Ķirbju   sēklas  ', $1, $1) returning name, name_normalized`, [unit]);
    expect(ok.rows[0]).toEqual({ name: 'Ķirbju sēklas', name_normalized: 'kirbju seklas' });
  });

  it('jaunas preces ierosinājums: dublikāti tiek aizturēti, pieteikumā izmantojama, administrators var apstiprināt ar pārdēvēšanu', async () => {
    const unit = await db.unit('kg');
    const cat = await db.id('product_categories', 'name', 'Sausās preces');
    await expectDbError(db.as(s.teacherA, `select public.propose_product('bietes', $1)`, [unit]), 'VT_DUPLICATE_NAME');
    await expectDbError(db.as(s.teacherA, `select public.propose_product('Mocarella', $1)`, [unit]), 'VT_DUPLICATE_ALIAS', 'Siers Mozzarella');
    const p = await db.as(s.teacherA, `select public.propose_product('Tapiokas pērles', $1, null, 'bubble tea nodarbībai') as r`, [unit]);
    const pid = p.rows[0].r.id;
    // pieteikumā drīkst izmantot pats ierosinātājs
    const rid = await db.tx(s.teacherA, async (q) => {
      const r = await q(`select public.save_request(null, $1::jsonb, $2::jsonb) as r`, [
        JSON.stringify({ period_id: s.period, lesson_date: '2026-10-06', topic: 'Bubble tea' }),
        JSON.stringify([{ product_id: pid, unit_id: unit, quantity: '0.5' }]),
      ]);
      await q(`select public.submit_request($1)`, [r.rows[0].r.id]);
      return r.rows[0].r.id as string;
    });
    // administrators redz jauno preci
    const pending = await db.as(s.admin, `select p.name, pp.status, pp.proposed_by, (select count(*)::int from public.request_items i where i.product_id = p.id) as uses
      from public.product_proposals pp join public.products p on p.id = pp.product_id where pp.status = 'pending'`);
    expect(pending.rows).toEqual([{ name: 'Tapiokas pērles', status: 'pending', proposed_by: s.teacherA, uses: 1 }]);
    // pedagogs pats nevar apstiprināt
    await expectDbError(db.as(s.teacherA, `select public.resolve_product_proposal($1, 'approve')`, [(await db.admin(`select id from public.product_proposals`)).rows[0].id]), 'VT_FORBIDDEN');
    const propId = (await db.admin(`select id from public.product_proposals`)).rows[0].id;
    await db.as(s.admin, `select public.resolve_product_proposal($1, 'approve', 'Tapiokas pērles melnās', $2, null, null, 'ok')`, [propId, cat]);
    const prod = await db.admin(`select name, approval_status, is_active, category_id, approved_by from public.products where id = $1`, [pid]);
    expect(prod.rows[0]).toMatchObject({ name: 'Tapiokas pērles melnās', approval_status: 'approved', is_active: true, category_id: cat, approved_by: s.admin });
    // tagad to redz visi
    expect((await search(s.teacherC, 'tapiok')).map((r) => r.name)).toEqual(['Tapiokas pērles melnās']);
    // iesniegtais pieteikums saglabāts ar to pašu product_id
    const items = await db.admin(`select product_id from public.request_items where request_id = $1`, [rid]);
    expect(items.rows[0].product_id).toBe(pid);
    await expectDbError(db.as(s.admin, `select public.resolve_product_proposal($1, 'approve')`, [propId]), 'VT_ALREADY_RESOLVED');
  });

  it('apvienošana: kļūdaini izveidotais produkts tiek apvienots ar pareizo; rindas, sinonīmi un vēsture saglabājas', async () => {
    const unit = await db.unit('kg');
    const wrong = (await db.as(s.teacherB, `select public.propose_product('Mozarela siers', $1) as r`, [unit])).rows[0].r.id;
    const target = await db.product('Siers Mozzarella');
    const req = await db.saveRequest(s.teacherB, { period_id: s.period, lesson_date: '2026-10-07', topic: 'Pica' }, [], { });
    await db.tx(s.teacherB, async (q) => {
      await q(`select public.save_request($1, $2::jsonb, $3::jsonb)`, [req, JSON.stringify({ period_id: s.period, lesson_date: '2026-10-07', topic: 'Pica' }),
        JSON.stringify([{ product_id: wrong, unit_id: unit, quantity: '2' }])]);
      await q(`select public.submit_request($1)`, [req]);
    });
    const propId = (await db.admin(`select id from public.product_proposals where product_id = $1`, [wrong])).rows[0].id;
    await expectDbError(db.as(s.teacherB, `select public.merge_products($1, $2)`, [wrong, target]), 'VT_FORBIDDEN');
    await db.as(s.admin, `select public.resolve_product_proposal($1, 'merge', null, null, null, $2, 'dublikāts')`, [propId, target]);

    const item = await db.admin(`select product_id from public.request_items where request_id = $1`, [req]);
    expect(item.rows[0].product_id).toBe(target);
    const src = await db.admin(`select is_active, merged_into from public.products where id = $1`, [wrong]);
    expect(src.rows[0]).toEqual({ is_active: false, merged_into: target });
    expect((await search(s.teacherA, 'mozarela siers')).map((r) => r.name)).toEqual(['Siers Mozzarella']); // vecais nosaukums tagad ir alias
    const prop = await db.admin(`select status, merged_into_product_id from public.product_proposals where id = $1`, [propId]);
    expect(prop.rows[0]).toEqual({ status: 'merged', merged_into_product_id: target });
    const audit = await db.as(s.admin, `select action, details from public.audit_log where entity_type = 'requests' and entity_id = $1 and action = 'item_update'`, [req]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].details.old_product_id).toBe(wrong);
    // pārvietotā rinda kopsummā parādās zem pareizās preces
    const sum = await db.as(s.admin, `select total_quantity from public.get_order_summary(p_period_id => $1, p_product_id => $2)`, [s.period, target]);
    expect(sum.rows[0].total_quantity).toBe('2.000');
  });

  it('noraidīta prece netiek meklēšanā un pedagogs to nevar izmantot; nosaukums atbrīvojas', async () => {
    const unit = await db.unit('kg');
    const pid = (await db.as(s.teacherC, `select public.propose_product('Zelta pārslas', $1) as r`, [unit])).rows[0].r.id;
    const propId = (await db.admin(`select id from public.product_proposals where product_id = $1`, [pid])).rows[0].id;
    await db.as(s.admin, `select public.resolve_product_proposal($1, 'reject', null, null, null, null, 'nav vajadzīga')`, [propId]);
    expect(await search(s.teacherC, 'zelta')).toEqual([]);
    const d = await db.saveRequest(s.teacherC, { topic: 'x' }, []);
    await expectDbError(db.as(s.teacherC, `insert into public.request_items (request_id, product_id, quantity, unit_id) values ($1,$2,1,$3)`, [d, pid, unit]), 'VT_PRODUCT_INACTIVE');
    // to pašu nosaukumu var ierosināt vēlreiz
    const again = await db.as(s.teacherC, `select public.propose_product('Zelta pārslas', $1) as r`, [unit]);
    expect(again.rows[0].r.id).not.toBe(pid);
  });

  it('kataloga imports: dublikāti tiek izlaisti, līdzīgie tiek atzīmēti (bet neapvienoti)', async () => {
    const kg = await db.unit('kg');
    const rows = ['Bietes', ' bietes tvaicetas ', 'Sviests 1×0,5 kg', 'Sviests 1×0,25 kg', 'Pilnīgi jauna prece', 'Pilnīgi jauna prece', 'Mocarella'];
    const sim = await db.as(s.admin, `select * from public.find_similar_products($1::text[]) order by input_index, similarity desc`, [rows]);
    const byIdx = (i: number) => sim.rows.filter((r) => r.input_index === i);
    expect(byIdx(1)[0]).toMatchObject({ product_name: 'Bietes', kind: 'exact' });
    expect(byIdx(2)[0]).toMatchObject({ product_name: 'Bietes tvaicētas', kind: 'exact' });
    expect(byIdx(3)[0]).toMatchObject({ product_name: 'Sviests 1×0,5 kg', kind: 'exact' });
    expect(byIdx(4).map((r) => r.product_name)).toContain('Sviests 1×0,5 kg');
    expect(byIdx(4)[0].kind).toBe('similar');
    expect(byIdx(5)).toEqual([]);
    expect(byIdx(7)[0]).toMatchObject({ product_name: 'Siers Mozzarella', kind: 'alias' });
    await expectDbError(db.as(s.teacherA, `select * from public.find_similar_products($1::text[])`, [rows]), 'VT_FORBIDDEN');

    const payload = rows.map((name) => ({ name, unit_id: kg, category_id: null, package_description: null }));
    const res = await db.as(s.admin, `select public.import_products($1::jsonb) as r`, [JSON.stringify(payload)]);
    expect(res.rows[0].r).toEqual({ inserted: 2, skipped: 5 }); // 'Sviests 1×0,25 kg' un 'Pilnīgi jauna prece'; 'Mocarella' ir alias, nevis nosaukums -> tiktu izveidots
  });

  it('27) seed satur visas specifikācijā minētās preces, kategorijas un mērvienības', async () => {
    const spec = ['Bietes', 'Bietes tvaicētas', 'Brokolini', 'Brokoļi', 'Burkāni', 'Citroni', 'Dilles svaigas', 'Kabači', 'Kartupeļi', 'Ķiploki', 'Ķirbis', 'Laimi', 'Lociņi',
      'Mango nogatavināti', 'Paprika sarkanā svaiga', 'Pastinaks', 'Pētersīļi lapu', 'Piparmētras svaigas', 'Saldais kartupelis', 'Selerijas sakne', 'Sīpoli', 'Sīpoli sarkanie',
      'Sīpoli šalotes', 'Spināti svaigi', 'Šampinjoni svaigi', 'Tomāti svaigi', 'Cūkgaļa maltā', 'Tītara fileja', 'Vistas fileja', 'Olas', 'Piens 2,5% 1×1 L', 'Krējums saldais 35%',
      'Krējums skābais 25%', 'Siers Čedaras', 'Siers Holandes', 'Sviests 1×0,2 kg', 'Sviests 1×0,5 kg', 'Cukurs', 'Kviešu milti 405. tips', 'Pūdercukurs', 'Raugs sausais', 'Sāls',
      'Vanilīna/Vanilas cukurs', 'Kārtainā mīkla', 'Baltais cepamais papīrs', 'Konteineri ar vāciņu', 'Maisiņi ar rokturi', 'Papīra maisiņi maizei', 'Uzlīmju lapiņas marķēšanai',
      // parauga pieteikuma (§28) preces
      'Rudzu maize nesagriezta', 'Baltmaize', 'Šprotes eļļā', 'Sakura komplekts', 'Apelsīni sulai'];
    const have = new Set((await db.admin(`select name from public.products`)).rows.map((r) => r.name));
    expect(spec.filter((n) => !have.has(n))).toEqual([]);
    const cats = (await db.admin(`select name from public.product_categories order by sort_order`)).rows.map((r) => r.name);
    expect(cats).toEqual(['Augļi un dārzeņi', 'Gaļa un putnu gaļa', 'Zivis un jūras produkti', 'Piena produkti', 'Maize un konditorejas izstrādājumi', 'Olas', 'Konservi', 'Eļļas un mērces',
      'Sausās preces', 'Milti un cepšanas produkti', 'Garšvielas', 'Rieksti un sēklas', 'Saldētie produkti', 'Iepakojums', 'Vienreizlietojamie materiāli', 'Marķēšanas materiāli', 'Citi']);
    const units = (await db.admin(`select code from public.units order by sort_order`)).rows.map((r) => r.code);
    expect(units).toEqual(['kg', 'g', 'L', 'ml', 'gab.', 'iep.', 'rullis', 'komplekts']);
    // "Piens 2,5% 1×1 L" tiek pasūtīts gabalos, nevis litros
    const milk = (await db.admin(`select u.code as ordered, b.code as base from public.products p join public.units u on u.id = p.order_unit_id join public.units b on b.id = p.base_unit_id where p.name = 'Piens 2,5% 1×1 L'`)).rows[0];
    expect(milk).toEqual({ ordered: 'gab.', base: 'L' });
  });

  it('veiktspēja: 10 000 produktu katalogā typeahead un saraksts paliek ātri', async () => {
    const kg = await db.unit('kg');
    await db.admin(
      `insert into public.products (name, base_unit_id, order_unit_id)
       select 'Testa prece ' || g || ' ' || (array['svaiga','saldēta','kūpināta','žāvēta','konservēta'])[1 + g % 5], $1, $1
       from generate_series(1, 10000) g`,
      [kg],
    );
    await db.admin(`analyze public.products`);
    const count = await db.admin(`select count(*)::int as n from public.products`);
    expect(count.rows[0].n).toBeGreaterThan(10000);
    const t0 = performance.now();
    const r = await db.as(s.teacherA, `select name from public.search_products('testa prece 77')`);
    const t1 = performance.now();
    const short = await db.as(s.teacherA, `select name from public.search_products('te')`);
    const t2 = performance.now();
    const list = await db.as(s.admin, `select name, total_count from public.list_products('konserv', null, 'all', null, 50, 0)`);
    const t3 = performance.now();
    expect(r.rows.length).toBeGreaterThan(0);
    expect(short.rows).toHaveLength(12);
    expect(Number(list.rows[0].total_count)).toBe(2000);
    expect(t1 - t0).toBeLessThan(500);
    expect(t2 - t1).toBeLessThan(500);
    expect(t3 - t2).toBeLessThan(800);
    console.info(`[veiktspēja] search 'testa prece 77': ${(t1 - t0).toFixed(0)} ms; 'te': ${(t2 - t1).toFixed(0)} ms; list: ${(t3 - t2).toFixed(0)} ms (10 000+ produkti, ieskaitot savienojumu)`);
  });
});
