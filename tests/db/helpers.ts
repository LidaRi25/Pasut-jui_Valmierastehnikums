import pg, { Client, type QueryResult } from 'pg';
import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import { TEMPLATE_DB } from './global-setup';

// PostgREST atgriež date kā 'yyyy-mm-dd' tekstu — testos to atdarinām (pg pēc noklusējuma dod JS Date)
pg.types.setTypeParser(1082, (v: string) => v);

export type Role = 'teacher' | 'admin' | 'sysadmin';

export class TestDb {
  constructor(
    readonly name: string,
    private readonly adminUrl: string,
  ) {}

  private url(dbName = this.name) {
    const u = new URL(this.adminUrl);
    u.pathname = `/${dbName}`;
    return u.toString();
  }

  /** Vaicājums ar superlietotāja tiesībām (apiet RLS) — testu sagatavošanai. */
  async admin(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const c = new Client({ connectionString: this.url() });
    await c.connect();
    try {
      return await c.query(sql, params);
    } finally {
      await c.end();
    }
  }

  /**
   * Izpilda darbību kā konkrēts lietotājs: tā pati lomu un JWT pretenziju pārslēgšana,
   * ko dara PostgREST (role authenticated + request.jwt.claims). userId = null -> anon.
   */
  async tx<T>(userId: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: this.url() });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(userId ? 'set local role authenticated' : 'set local role anon');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }),
      ]);
      const result = await fn((sql, params = []) => c.query(sql, params));
      await c.query('commit');
      return result;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      await c.end();
    }
  }

  /** Viens vaicājums kā lietotājs. */
  async as(userId: string | null, sql: string, params: unknown[] = []): Promise<QueryResult> {
    return this.tx(userId, (q) => q(sql, params));
  }

  async createUser(email: string, fullName: string, role: Role = 'teacher'): Promise<string> {
    const id = randomUUID();
    await this.admin(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, email, JSON.stringify({ full_name: fullName })],
    );
    if (role !== 'teacher') {
      await this.admin(`update public.user_roles set role = $2 where user_id = $1`, [id, role]);
    }
    return id;
  }

  async id(table: string, column: string, value: string): Promise<string> {
    const r = await this.admin(`select id from public.${table} where ${column} = $1`, [value]);
    if (!r.rows[0]) throw new Error(`Nav atrasts ${table}.${column} = ${value}`);
    return r.rows[0].id;
  }

  product(name: string) {
    return this.id('products', 'name', name);
  }
  unit(code: string) {
    return this.id('units', 'code', code);
  }
  group(name: string) {
    return this.id('groups', 'name', name);
  }

  async createPeriod(name: string, start: string, end: string, deadlineIso: string, status = 'open'): Promise<string> {
    const r = await this.admin(
      `insert into public.order_periods (name, start_date, end_date, submission_deadline, status)
       values ($1,$2,$3,$4,$5) returning id`,
      [name, start, end, deadlineIso, status],
    );
    return r.rows[0].id;
  }

  /** Saglabā (un pēc izvēles iesniedz) pieteikumu kā konkrēts lietotājs — tas pats ceļš, ko izmanto lietotne. */
  async saveRequest(
    userId: string,
    data: Record<string, unknown>,
    items: Array<{ product: string; unit?: string; quantity: string | null; notes?: string }>,
    opts: { id?: string; submit?: boolean } = {},
  ): Promise<string> {
    const payloadItems: Array<{ product_id: string; unit_id: string; quantity: string | null; notes: string | null }> = [];
    for (const it of items) {
      const pid = await this.product(it.product);
      const uRow = await this.admin(
        `select order_unit_id from public.products where id = $1`,
        [pid],
      );
      payloadItems.push({
        product_id: pid,
        unit_id: it.unit ? await this.unit(it.unit) : uRow.rows[0].order_unit_id,
        quantity: it.quantity,
        notes: it.notes ?? null,
      });
    }
    return this.tx(userId, async (q) => {
      const saved = await q(`select public.save_request($1, $2::jsonb, $3::jsonb) as r`, [
        opts.id ?? null,
        JSON.stringify(data),
        JSON.stringify(payloadItems),
      ]);
      const id = saved.rows[0].r.id as string;
      if (opts.submit) await q(`select public.submit_request($1)`, [id]);
      return id;
    });
  }
}

export function dbAvailable(): boolean {
  return Boolean(inject('dbAdminUrl'));
}

let counter = 0;
export async function newDb(): Promise<{ db: TestDb; drop: () => Promise<void> }> {
  const adminUrl = inject('dbAdminUrl');
  const name = `vt_t_${process.pid}_${Date.now()}_${counter++}`;
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  await c.query(`create database ${name} template ${TEMPLATE_DB}`);
  await c.end();
  const db = new TestDb(name, adminUrl);
  return {
    db,
    drop: async () => {
      const a = new Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export function futureIso(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

/** Pārbauda, ka DB darbība beidzas ar konkrētu VT_* kļūdas kodu (un, ja norādīts, detaļu fragmentu). */
export async function expectDbError(p: Promise<unknown>, code: string, detailIncludes?: string) {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; detail?: string };
    if (!String(err.message).includes(code)) {
      throw new Error(`Gaidīta kļūda ${code}, bet saņemta: ${err.message}`);
    }
    if (detailIncludes && !String(err.detail ?? '').includes(detailIncludes)) {
      throw new Error(`Gaidīta detaļa "${detailIncludes}", bet saņemta: ${err.detail}`);
    }
    return;
  }
  throw new Error(`Gaidīta kļūda ${code}, bet darbība izdevās`);
}

/** Standarta scenārijs: 3 pedagogi, pasūtītājs, sistēmas administrators, atvērts periods. */
export async function baseScenario(db: TestDb) {
  const teacherA = await db.createUser('sanita@vt.test', 'Sanita Reinfelde');
  const teacherB = await db.createUser('janis@vt.test', 'Jānis Bērziņš');
  const teacherC = await db.createUser('ilze@vt.test', 'Ilze Kalniņa');
  const admin = await db.createUser('pasutitajs@vt.test', 'Pasūtītājs', 'admin');
  const sysadmin = await db.createUser('sys@vt.test', 'Sistēmas administrators', 'sysadmin');
  const period = await db.createPeriod('05.10.2026.–09.10.2026.', '2026-10-05', '2026-10-09', futureIso(30));
  const g1 = await db.group('1. grupa');
  const g2 = await db.group('2. grupa');
  const g3 = await db.group('3. grupa');
  return { teacherA, teacherB, teacherC, admin, sysadmin, period, g1, g2, g3 };
}
