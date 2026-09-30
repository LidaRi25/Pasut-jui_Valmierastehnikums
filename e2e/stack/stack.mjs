#!/usr/bin/env node
// Lokāls Supabase-saderīgs steks testēšanai BEZ Docker:
//   PostgreSQL (jau darbojošs) + GoTrue (supabase/auth) + PostgREST + neliels vārtejas serveris (/auth/v1, /rest/v1).
// Izmanto e2e testiem un manuālai pārbaudei. Reālā Supabase vidē tas NAV vajadzīgs.
//
// Lietošana:  node e2e/stack/stack.mjs up | down
// Vides mainīgie: E2E_PG_URL, GOTRUE_BIN, GOTRUE_DIR, POSTGREST_BIN, E2E_DB (noklusēti skat. zemāk)
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = path.join(root, 'e2e/.tmp');
const PG_URL = process.env.E2E_PG_URL ?? 'postgres://postgres@127.0.0.1:54322/postgres';
const DB = process.env.E2E_DB ?? 'vt_e2e';
const GOTRUE_BIN = process.env.GOTRUE_BIN ?? 'gotrue';
const GOTRUE_DIR = process.env.GOTRUE_DIR ?? '.';
const POSTGREST_BIN = process.env.POSTGREST_BIN ?? 'postgrest';
const JWT_SECRET = process.env.E2E_JWT_SECRET ?? 'e2e-only-jwt-secret-at-least-32-characters-long!!';
const GATEWAY_PORT = 54321;
const GOTRUE_PORT = 9999;
const POSTGREST_PORT = 3001;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
export const ANON_KEY = jwt({ role: 'anon', iss: 'supabase-e2e', exp });
export const SERVICE_KEY = jwt({ role: 'service_role', iss: 'supabase-e2e', exp });

function dbUrl(name, user, pw) {
  const u = new URL(PG_URL);
  u.pathname = `/${name}`;
  if (user) {
    u.username = user;
    u.password = pw ?? '';
  }
  return u.toString();
}

async function prepareDatabase() {
  const admin = new pg.Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login password 'auth_pw'; end if;
      if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin noinherit createrole login password 'gotrue_pw'; end if;
    end $$;
    grant anon, authenticated, service_role to authenticator;
  `);
  await admin.query(`create database ${DB}`);
  await admin.end();

  const c = new pg.Client({ connectionString: dbUrl(DB) });
  await c.connect();
  await c.query(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create schema if not exists auth authorization supabase_auth_admin;
    grant usage on schema auth to anon, authenticated, service_role;
    grant create on database ${DB} to supabase_auth_admin;
    alter user supabase_auth_admin set search_path = 'auth';
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await c.end();
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} -> ${code}`))));
  });
}

const gotrueEnv = () => ({
  ...process.env,
  GOTRUE_API_HOST: '127.0.0.1',
  PORT: String(GOTRUE_PORT),
  API_EXTERNAL_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
  GOTRUE_DB_DRIVER: 'postgres',
  GOTRUE_DB_DATABASE_URL: dbUrl(DB, 'supabase_auth_admin', 'gotrue_pw') + '?search_path=auth',
  DATABASE_URL: dbUrl(DB, 'supabase_auth_admin', 'gotrue_pw') + '?search_path=auth',
  GOTRUE_SITE_URL: 'http://127.0.0.1:3000',
  GOTRUE_JWT_SECRET: JWT_SECRET,
  GOTRUE_JWT_EXP: '3600',
  GOTRUE_JWT_AUD: 'authenticated',
  GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
  GOTRUE_DISABLE_SIGNUP: 'true',
  GOTRUE_MAILER_AUTOCONFIRM: 'true',
  GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
  GOTRUE_LOG_LEVEL: 'warn',
  GOTRUE_DB_MIGRATIONS_PATH: path.join(GOTRUE_DIR, 'migrations'),
  GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000',
  GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '10',
});

async function applyAppMigrations() {
  const c = new pg.Client({ connectionString: dbUrl(DB) });
  await c.connect();
  const migDir = path.join(root, 'supabase/migrations');
  for (const f of fs.readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort()) {
    await c.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
  }
  await c.query(fs.readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'));
  await c.end();
}

function startGateway() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let target;
    if (url.pathname.startsWith('/auth/v1/')) {
      target = `http://127.0.0.1:${GOTRUE_PORT}${url.pathname.slice('/auth/v1'.length)}${url.search}`;
    } else if (url.pathname.startsWith('/rest/v1/')) {
      target = `http://127.0.0.1:${POSTGREST_PORT}${url.pathname.slice('/rest/v1'.length)}${url.search}`;
    } else {
      res.writeHead(404).end('not found');
      return;
    }
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks),
        redirect: 'manual',
      });
      const out = {};
      upstream.headers.forEach((v, k) => {
        if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) out[k] = v;
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, out).end(buf);
    } catch (e) {
      res.writeHead(502).end(String(e));
    }
  });
  server.listen(GATEWAY_PORT, '127.0.0.1');
  return server;
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* zaudēts savienojums — gaidām */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} nestartēja`);
}

async function up() {
  fs.mkdirSync(tmp, { recursive: true });
  await prepareDatabase();
  console.log('[stack] GoTrue migrācijas…');
  await run(GOTRUE_BIN, ['migrate'], { env: gotrueEnv(), cwd: GOTRUE_DIR });
  console.log('[stack] Lietotnes migrācijas + seed…');
  await applyAppMigrations();

  const logs = (n) => fs.openSync(path.join(tmp, n), 'a');
  const g = spawn(GOTRUE_BIN, ['serve'], { env: gotrueEnv(), cwd: GOTRUE_DIR, detached: true, stdio: ['ignore', logs('gotrue.log'), logs('gotrue.log')] });
  g.unref();
  const pr = spawn(POSTGREST_BIN, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUrl(DB, 'authenticator', 'auth_pw'),
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(POSTGREST_PORT),
      PGRST_DB_MAX_ROWS: '10000',
    },
    detached: true,
    stdio: ['ignore', logs('postgrest.log'), logs('postgrest.log')],
  });
  pr.unref();
  fs.writeFileSync(path.join(tmp, 'pids.json'), JSON.stringify({ gotrue: g.pid, postgrest: pr.pid }));

  await waitFor(`http://127.0.0.1:${GOTRUE_PORT}/health`, 'GoTrue');
  await waitFor(`http://127.0.0.1:${POSTGREST_PORT}/`, 'PostgREST');

  // Vārteja darbojas atsevišķā procesā, lai izdzīvotu šī skripta beigas
  const gw = spawn(process.execPath, [fileURLToPath(import.meta.url), 'gateway'], {
    detached: true,
    stdio: ['ignore', logs('gateway.log'), logs('gateway.log')],
    env: process.env,
  });
  gw.unref();
  const pids = JSON.parse(fs.readFileSync(path.join(tmp, 'pids.json'), 'utf8'));
  pids.gateway = gw.pid;
  fs.writeFileSync(path.join(tmp, 'pids.json'), JSON.stringify(pids));
  await waitFor(`http://127.0.0.1:${GATEWAY_PORT}/auth/v1/health`, 'vārteja');

  const env = [
    `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${GATEWAY_PORT}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}`,
    // lokāli testi notiek pa http — sesijas sīkdatnes bez Secure atzīmes
    'NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100',
  ].join('\n');
  fs.writeFileSync(path.join(tmp, 'env'), env + '\n');
  console.log('[stack] Gatavs. Vides mainīgie ierakstīti e2e/.tmp/env');
}

function down() {
  const f = path.join(tmp, 'pids.json');
  if (!fs.existsSync(f)) return;
  for (const pid of Object.values(JSON.parse(fs.readFileSync(f, 'utf8')))) {
    try {
      process.kill(pid);
    } catch {
      /* jau apturēts */
    }
  }
  fs.rmSync(f);
  console.log('[stack] Apturēts.');
}

const cmd = process.argv[2];
if (cmd === 'up') await up();
else if (cmd === 'down') down();
else if (cmd === 'gateway') startGateway();
else console.log('Lietošana: stack.mjs up | down');
