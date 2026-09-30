import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseScenario, dbAvailable, expectDbError, newDb, type TestDb } from './helpers';

describe.skipIf(!dbAvailable())('Lomas un Row Level Security (DB)', () => {
  let db: TestDb;
  let drop: () => Promise<void>;
  let s: Awaited<ReturnType<typeof baseScenario>>;
  let reqA: string;
  let reqB: string;

  beforeAll(async () => {
    ({ db, drop } = await newDb());
    s = await baseScenario(db);
    reqA = await db.saveRequest(s.teacherA, { period_id: s.period, lesson_date: '2026-10-06', topic: 'A nodarbība' },
      [{ product: 'Bietes', quantity: '1' }], { submit: true });
    reqB = await db.saveRequest(s.teacherB, { period_id: s.period, lesson_date: '2026-10-07', topic: 'B nodarbība' },
      [{ product: 'Kabači', quantity: '2' }]);
  });
  afterAll(async () => {
    await drop?.();
  });

  it('4) pedagogs redz tikai savus pieteikumus un to rindas', async () => {
    const a = await db.as(s.teacherA, `select id, topic from public.requests order by topic`);
    expect(a.rows.map((r) => r.topic)).toEqual(['A nodarbība']);
    const b = await db.as(s.teacherB, `select id from public.requests`);
    expect(b.rows.map((r) => r.id)).toEqual([reqB]);
    const items = await db.as(s.teacherB, `select request_id from public.request_items`);
    expect(new Set(items.rows.map((r) => r.request_id))).toEqual(new Set([reqB]));
  });

  it('4) URL/ID nomaiņa neatver cita pedagoga pieteikumu (tieša piekļuve pēc id)', async () => {
    const r = await db.as(s.teacherB, `select * from public.requests where id = $1`, [reqA]);
    expect(r.rows).toHaveLength(0);
    const i = await db.as(s.teacherB, `select * from public.request_items where request_id = $1`, [reqA]);
    expect(i.rows).toHaveLength(0);
    await expectDbError(db.as(s.teacherB, `select public.copy_request($1)`, [reqA]), 'VT_NOT_FOUND');
  });

  it('4) pedagogs nevar labot, dzēst vai papildināt cita pedagoga pieteikumu', async () => {
    const u = await db.as(s.teacherB, `update public.requests set topic = 'nolaupīts' where id = $1`, [reqA]);
    expect(u.rowCount).toBe(0);
    const d = await db.as(s.teacherB, `delete from public.requests where id = $1`, [reqA]);
    expect(d.rowCount).toBe(0);
    const prod = await db.product('Burkāni');
    const unit = await db.unit('kg');
    await expect(
      db.as(s.teacherB, `insert into public.request_items (request_id, product_id, quantity, unit_id) values ($1,$2,5,$3)`, [reqA, prod, unit]),
    ).rejects.toThrow(/row-level security/);
    await expectDbError(
      db.as(s.teacherB, `select public.save_request($1, '{"topic":"x"}'::jsonb, '[]'::jsonb)`, [reqA]),
      'VT_NOT_FOUND',
    );
    const check = await db.admin(`select topic from public.requests where id = $1`, [reqA]);
    expect(check.rows[0].topic).toBe('A nodarbība');
  });

  it('5) administrators redz visus pieteikumus un var tos labot', async () => {
    const all = await db.as(s.admin, `select topic from public.requests order by topic`);
    expect(all.rows.map((r) => r.topic)).toEqual(['A nodarbība', 'B nodarbība']);
    const u = await db.as(s.admin, `update public.requests set notes = 'Admin piezīme' where id = $1`, [reqA]);
    expect(u.rowCount).toBe(1);
  });

  it('pedagogs nevar saņemt kopējo pasūtījumu, auditu vai citu administratora datus', async () => {
    await expectDbError(db.as(s.teacherA, `select * from public.get_order_summary()`), 'VT_FORBIDDEN');
    await expectDbError(db.as(s.teacherA, `select * from public.order_lines()`), 'VT_FORBIDDEN');
    await expectDbError(db.as(s.teacherA, `select public.dashboard_stats($1)`, [s.period]), 'VT_FORBIDDEN');
    const audit = await db.as(s.teacherA, `select * from public.audit_log`);
    expect(audit.rows).toHaveLength(0);
    const profiles = await db.as(s.teacherA, `select id from public.profiles`);
    expect(profiles.rows.map((r) => r.id)).toEqual([s.teacherA]);
    const adminAudit = await db.as(s.admin, `select count(*)::int as n from public.audit_log`);
    expect(adminAudit.rows[0].n).toBeGreaterThan(0);
  });

  it('pedagogs nevar sev piešķirt administratora lomu vai atjaunot deaktivizētu kontu', async () => {
    const r = await db.as(s.teacherA, `update public.user_roles set role = 'sysadmin' where user_id = $1`, [s.teacherA]);
    expect(r.rowCount).toBe(0);
    const p = await db.as(s.teacherA, `update public.profiles set full_name = 'Hakeris' where id = $1`, [s.teacherA]);
    expect(p.rowCount).toBe(0);
    await expect(
      db.as(s.teacherA, `insert into public.user_roles (user_id, role) values ($1, 'admin')`, [s.teacherB]),
    ).rejects.toThrow(/row-level security/);
    const role = await db.admin(`select role from public.user_roles where user_id = $1`, [s.teacherA]);
    expect(role.rows[0].role).toBe('teacher');
    // vārdu drīkst mainīt tikai caur kontrolēto funkciju
    await db.as(s.teacherA, `select public.update_own_profile('  Sanita   Reinfelde-Ozola ')`);
    const n = await db.admin(`select full_name from public.profiles where id = $1`, [s.teacherA]);
    expect(n.rows[0].full_name).toBe('Sanita Reinfelde-Ozola');
    await db.admin(`update public.profiles set full_name = 'Sanita Reinfelde' where id = $1`, [s.teacherA]);
  });

  it('pasūtītājs (admin) nevar pārvaldīt lietotājus, mērvienības un grupas; sistēmas administrators var', async () => {
    const r = await db.as(s.admin, `update public.user_roles set role = 'sysadmin' where user_id = $1`, [s.teacherA]);
    expect(r.rowCount).toBe(0);
    await expect(db.as(s.admin, `insert into public.groups (name) values ('Jauna')`)).rejects.toThrow(/row-level security/);
    await expect(db.as(s.admin, `insert into public.units (code, name) values ('x','x')`)).rejects.toThrow(/row-level security/);
    // kategorijas admin drīkst
    const cat = await db.as(s.admin, `insert into public.product_categories (name) values ('Testa kategorija') returning id`);
    expect(cat.rowCount).toBe(1);
    await db.as(s.sysadmin, `insert into public.groups (name) values ('Jauna grupa')`);
    const up = await db.as(s.sysadmin, `update public.user_roles set role = 'admin' where user_id = $1`, [s.teacherC]);
    expect(up.rowCount).toBe(1);
    await db.as(s.sysadmin, `update public.user_roles set role = 'teacher' where user_id = $1`, [s.teacherC]);
  });

  it('anonīma piekļuve ir liegta', async () => {
    await expect(db.as(null, `select * from public.requests`)).rejects.toThrow(/permission denied/);
    await expect(db.as(null, `select * from public.products`)).rejects.toThrow(/permission denied/);
    await expect(db.as(null, `select * from public.search_products('bie')`)).rejects.toThrow(/permission denied/);
  });

  it('audit_log nav labojams vai dzēšams (arī administratoram)', async () => {
    await expect(db.as(s.admin, `update public.audit_log set action = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(db.as(s.admin, `delete from public.audit_log`)).rejects.toThrow(/permission denied/);
    await expect(db.as(s.admin, `insert into public.audit_log (action, entity_type) values ('x','y')`)).rejects.toThrow(/permission denied/);
    await expectDbError(db.admin(`update public.audit_log set action = 'x'`), 'VT_AUDIT_IMMUTABLE');
    await expectDbError(db.admin(`delete from public.audit_log`), 'VT_AUDIT_IMMUTABLE');
    await expectDbError(db.admin(`truncate public.audit_log`), 'VT_AUDIT_IMMUTABLE');
  });

  it('audits reģistrē iesniegšanu, statusa maiņu un izmaiņas pēc iesniegšanas', async () => {
    await db.as(s.admin, `update public.requests set status = 'approved' where id = $1`, [reqA]);
    const prod = await db.product('Burkāni');
    const unit = await db.unit('kg');
    await db.as(s.admin, `insert into public.request_items (request_id, product_id, quantity, unit_id) values ($1,$2,3,$3)`, [reqA, prod, unit]);
    const log = await db.as(s.admin, `select action, actor_name, details from public.audit_log where entity_type = 'requests' and entity_id = $1 order by id`, [reqA]);
    const actions = log.rows.map((r) => r.action);
    expect(actions).toContain('status_change');
    expect(actions).toContain('item_insert');
    const submit = log.rows.find((r) => r.action === 'status_change' && r.details.to === 'submitted');
    expect(submit.actor_name).toBe('Sanita Reinfelde');
    expect(submit.details.submitted_at).toBeTruthy();
    const change = log.rows.find((r) => r.action === 'status_change' && r.details.to === 'approved');
    expect(change.actor_name).toBe('Pasūtītājs');
    // melnraksta autosaglabāšana audita neaizpilda
    const draftLog = await db.as(s.admin, `select count(*)::int as n from public.audit_log where entity_type = 'requests' and entity_id = $1`, [reqB]);
    expect(draftLog.rows[0].n).toBe(0);
  });

  it('papildu tiesības: pedagogs redz cita pedagoga pieteikumus tikai ar administratora piešķirtu piekļuvi', async () => {
    const own = await db.saveRequest(s.teacherA, { period_id: s.period, lesson_date: '2026-10-08', topic: 'A koplietošana' },
      [{ product: 'Bietes', quantity: '1' }], { submit: true });
    await expect(
      db.as(s.teacherC, `insert into public.teacher_access_grants (owner_id, grantee_id) values ($1,$2)`, [s.teacherA, s.teacherC]),
    ).rejects.toThrow(/row-level security/);
    await db.as(s.admin, `insert into public.teacher_access_grants (owner_id, grantee_id, can_edit) values ($1,$2,false)`, [s.teacherA, s.teacherC]);
    const seen = await db.as(s.teacherC, `select topic from public.requests where teacher_id = $1 order by topic`, [s.teacherA]);
    expect(seen.rows.map((r) => r.topic)).toContain('A koplietošana');
    const upd = await db.as(s.teacherC, `update public.requests set notes = 'no C' where id = $1`, [own]);
    expect(upd.rowCount).toBe(0); // tikai skatīšanās
    await db.as(s.admin, `update public.teacher_access_grants set can_edit = true where owner_id = $1 and grantee_id = $2`, [s.teacherA, s.teacherC]);
    const upd2 = await db.as(s.teacherC, `update public.requests set notes = 'no C' where id = $1`, [own]);
    expect(upd2.rowCount).toBe(1);
    await db.as(s.admin, `delete from public.teacher_access_grants where owner_id = $1`, [s.teacherA]);
    const after = await db.as(s.teacherC, `select * from public.requests`);
    expect(after.rows).toHaveLength(0);
  });

  it('deaktivizēts lietotājs zaudē visu piekļuvi; pēdējo sistēmas administratoru nevar deaktivizēt', async () => {
    await db.as(s.sysadmin, `update public.profiles set is_active = false where id = $1`, [s.teacherB]);
    const r = await db.as(s.teacherB, `select * from public.requests`);
    expect(r.rows).toHaveLength(0);
    const prod = await db.as(s.teacherB, `select * from public.search_products('bie')`);
    expect(prod.rows).toHaveLength(0);
    await expect(
      db.as(s.teacherB, `select public.save_request(null, '{"topic":"x"}'::jsonb, '[]'::jsonb)`),
    ).rejects.toThrow();
    await db.as(s.sysadmin, `update public.profiles set is_active = true where id = $1`, [s.teacherB]);
    // pēdējais sysadmin
    await expectDbError(db.as(s.sysadmin, `update public.profiles set is_active = false where id = $1`, [s.sysadmin]), 'VT_LAST_SYSADMIN');
    await expectDbError(db.as(s.sysadmin, `update public.user_roles set role = 'admin' where user_id = $1`, [s.sysadmin]), 'VT_LAST_SYSADMIN');
  });

  it('jaunu preci (ierosinājumu) līdz apstiprināšanai redz tikai autors un administratori', async () => {
    const unit = await db.unit('kg');
    await db.as(s.teacherA, `select public.propose_product('Kvinoja sarkanā', $1, null, 'vajag nodarbībai')`, [unit]);
    const own = await db.as(s.teacherA, `select name from public.search_products('kvinoj')`);
    expect(own.rows.map((r) => r.name)).toEqual(['Kvinoja sarkanā']);
    const other = await db.as(s.teacherC, `select name from public.search_products('kvinoj')`);
    expect(other.rows).toHaveLength(0);
    const otherProducts = await db.as(s.teacherC, `select name from public.products where name like 'Kvinoja%'`);
    expect(otherProducts.rows).toHaveLength(0);
    const adm = await db.as(s.admin, `select name from public.products where name like 'Kvinoja%'`);
    expect(adm.rows).toHaveLength(1);
    // pedagogs nevar sev izveidot jau apstiprinātu preci
    await expect(
      db.as(s.teacherA, `insert into public.products (name, base_unit_id, order_unit_id, approval_status, created_by) values ('Hakeru prece', $1, $1, 'approved', $2)`, [unit, s.teacherA]),
    ).rejects.toThrow(/row-level security/);
    // un cits pedagogs nevar izmantot cita pedagoga neapstiprinātu preci
    const pid = (await db.admin(`select id from public.products where name = 'Kvinoja sarkanā'`)).rows[0].id;
    const draftC = await db.as(s.teacherC, `select public.save_request(null, '{"topic":"C"}'::jsonb, '[]'::jsonb) as r`);
    await expectDbError(
      db.as(s.teacherC, `insert into public.request_items (request_id, product_id, quantity, unit_id) values ($1,$2,1,$3)`, [draftC.rows[0].r.id, pid, unit]),
      'VT_PRODUCT_INACTIVE',
    );
  });
});
