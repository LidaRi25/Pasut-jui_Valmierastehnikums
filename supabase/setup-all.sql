-- =============================================================================
-- Valmieras tehnikums — pilna datubāzes uzstādīšana vienā failā
-- ĢENERĒTS FAILS (node scripts/bundle-sql.mjs). Nelabojiet to — labojiet supabase/migrations/*.sql.
-- Ielīmējiet Supabase → SQL Editor un izpildiet VIENREIZ jaunā, tukšā projektā.
-- =============================================================================

-- >>>>>>>>>> migrācija: 20260901000100_extensions_and_types.sql
-- =============================================================================
-- Valmieras tehnikums — pieteikumu pārvaldības sistēma
-- 01: paplašinājumi, uzskaitījuma tipi, teksta normalizācija
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Lomas: teacher = pedagogs, admin = pasūtītājs/administrators, sysadmin = sistēmas administrators
create type public.app_role as enum ('teacher', 'admin', 'sysadmin');

-- Pieteikuma statusi: Melnraksts, Iesniegts, Apstiprināts, Iekļauts pasūtījumā, Pasūtīts, Atcelts
create type public.request_status as enum
  ('draft', 'submitted', 'approved', 'included', 'ordered', 'cancelled');

-- Perioda statusi: Atvērts, Slēgts, Apkopošanā, Pasūtīts, Arhivēts
create type public.period_status as enum
  ('open', 'closed', 'collecting', 'ordered', 'archived');

-- Preces apstiprināšanas statuss (jaunas preces gaida administratora lēmumu)
create type public.approval_status as enum ('pending', 'approved', 'rejected');

-- Jaunas preces ierosinājuma statuss
create type public.proposal_status as enum ('pending', 'approved', 'merged', 'rejected');

-- Meklēšanai paredzēta normalizācija: mazie burti, latviešu diakritiskās zīmes -> bāzes burti,
-- "×" -> "x", decimālkomats starp cipariem -> punkts (0,5 = 0.5), liekās atstarpes.
-- Oriģinālais nosaukums vienmēr tiek saglabāts nemainīts.
create or replace function public.normalize_text(t text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(
          translate(
            coalesce(t, ''),
            'ĀāČčĒēĢģĪīĶķĻļŅņŠšŪūŽž×',
            'AaCcEeGgIiKkLlNnSsUuZzx'
          )
        ),
        '(\d),(\d)', '\1.\2', 'g'
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

-- LIKE / ILIKE speciālo simbolu izbēgšana (aizsardzība pret nepareizu meklēšanas ievadi)
create or replace function public.escape_like(t text)
returns text
language sql
immutable
parallel safe
as $$
  select replace(replace(replace(coalesce(t, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- >>>>>>>>>> migrācija: 20260901000200_core_tables.sql
-- =============================================================================
-- 02: pamattabulas
-- =============================================================================

-- ---------- Atsauces dati ----------------------------------------------------

create table public.units (
  id            uuid primary key default gen_random_uuid(),
  code          text not null check (length(btrim(code)) between 1 and 20),
  name          text not null check (length(btrim(name)) between 1 and 60),
  -- Vienības, ko skaita veselos (gab., iep., rullis, komplekts) — attēlošanai bez liekām decimāldaļām
  is_countable  boolean not null default false,
  -- Brīdinājuma slieksnis "neparasti liels daudzums" (NULL = bez brīdinājuma)
  warn_quantity numeric(14,3) check (warn_quantity is null or warn_quantity > 0),
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index units_code_unique on public.units (lower(code));

create table public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 100),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index product_categories_name_unique on public.product_categories (lower(name));

create table public.courses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 100),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index courses_name_unique on public.courses (lower(name));

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 100),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index groups_name_unique on public.groups (lower(name));

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ---------- Lietotāji un lomas ------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text not null default '',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  role       public.app_role not null default 'teacher',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Papildu tiesības: administrators var atļaut vienam pedagogam skatīt (un pēc izvēles labot)
-- cita pedagoga pieteikumus.
create table public.teacher_access_grants (
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  grantee_id uuid not null references public.profiles (id) on delete cascade,
  can_edit   boolean not null default false,
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (owner_id, grantee_id),
  check (owner_id <> grantee_id)
);
create index teacher_access_grants_grantee_idx on public.teacher_access_grants (grantee_id);

-- ---------- Pasūtījumu periodi ---------------------------------------------------

create table public.order_periods (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(btrim(name)) between 1 and 120),
  start_date          date not null,
  end_date            date not null,
  submission_deadline timestamptz not null,
  status              public.period_status not null default 'open',
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  check (end_date >= start_date)
);
create index order_periods_status_idx on public.order_periods (status, start_date desc);

-- ---------- Produktu katalogs -------------------------------------------------------

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(btrim(name)) between 1 and 200),
  -- Meklēšanas nosaukums; uztur trigeris (normalize_text(name))
  name_normalized     text not null,
  category_id         uuid references public.product_categories (id) on delete set null,
  base_unit_id        uuid not null references public.units (id),
  order_unit_id       uuid not null references public.units (id),
  package_description text,
  -- Cik pamatvienību ir vienā pasūtīšanas vienībā (piem., sviests 1×0,2 kg: 0,2 kg uz 1 gab.)
  package_quantity    numeric(14,3) check (package_quantity is null or package_quantity > 0),
  barcode             text,
  notes               text,
  is_active           boolean not null default true,
  approval_status     public.approval_status not null default 'approved',
  -- Ja produkts ir apvienots ar citu (kļūdaini izveidots dublikāts), norāda pareizo produktu
  merged_into         uuid references public.products (id) on delete set null,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles (id) on delete set null,
  approved_at         timestamptz,
  approved_by         uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now(),
  check (merged_into is null or merged_into <> id)
);
-- Vienāds normalizētais nosaukums nav atļauts (izņemot apvienotos un noraidītos ierakstus).
-- "Sviests 1×0,2 kg" un "Sviests 1×0,5 kg" ir dažādi nosaukumi, tāpēc netiek apvienoti.
create unique index products_name_unique
  on public.products (name_normalized)
  where merged_into is null and approval_status <> 'rejected';
create index products_name_trgm on public.products using gin (name_normalized extensions.gin_trgm_ops);
create index products_name_prefix on public.products (name_normalized text_pattern_ops);
create index products_category_idx on public.products (category_id);
create index products_status_idx on public.products (approval_status, is_active);
create index products_created_by_idx on public.products (created_by) where approval_status = 'pending';

create table public.product_aliases (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete cascade,
  alias            text not null check (length(btrim(alias)) between 1 and 200),
  alias_normalized text not null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create unique index product_aliases_unique on public.product_aliases (alias_normalized);
create index product_aliases_product_idx on public.product_aliases (product_id);
create index product_aliases_trgm on public.product_aliases using gin (alias_normalized extensions.gin_trgm_ops);

-- ---------- Pieteikumi ---------------------------------------------------------------

create table public.requests (
  id              uuid primary key default gen_random_uuid(),
  request_no      bigint generated always as identity,
  teacher_id      uuid not null references public.profiles (id) on delete restrict,
  period_id       uuid references public.order_periods (id) on delete restrict,
  course_id       uuid references public.courses (id) on delete set null,
  group_id        uuid references public.groups (id) on delete set null,
  students        text check (students is null or length(students) <= 500),
  topic           text not null default '' check (length(topic) <= 300),
  lesson_date     date,
  student_count   integer check (student_count is null or student_count between 0 and 10000),
  notes           text check (notes is null or length(notes) <= 2000),
  status          public.request_status not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  last_edited_by  uuid
);
create unique index requests_request_no_unique on public.requests (request_no);
create index requests_teacher_idx on public.requests (teacher_id, created_at desc);
create index requests_period_status_idx on public.requests (period_id, status);
create index requests_status_idx on public.requests (status);
create index requests_lesson_date_idx on public.requests (lesson_date);
create index requests_group_idx on public.requests (group_id);
create index requests_course_idx on public.requests (course_id);

create table public.request_items (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  position   integer not null default 0,
  product_id uuid not null references public.products (id) on delete restrict,
  -- Melnrakstā daudzums var būt vēl neaizpildīts; iesniegšanas brīdī tam jābūt > 0
  quantity   numeric(14,3) check (quantity is null or quantity > 0),
  unit_id    uuid not null references public.units (id),
  notes      text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index request_items_request_idx on public.request_items (request_id, position);
create index request_items_product_idx on public.request_items (product_id, unit_id);

-- Jaunas preces ierosinājums (pedagogs -> administrators)
create table public.product_proposals (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products (id) on delete cascade,
  proposed_name         text not null,
  unit_id               uuid not null references public.units (id),
  category_id           uuid references public.product_categories (id) on delete set null,
  notes                 text,
  status                public.proposal_status not null default 'pending',
  proposed_by           uuid not null references public.profiles (id) on delete cascade,
  resolved_by           uuid references public.profiles (id) on delete set null,
  resolved_at           timestamptz,
  resolution_note       text,
  merged_into_product_id uuid references public.products (id) on delete set null,
  created_at            timestamptz not null default now()
);
create index product_proposals_status_idx on public.product_proposals (status, created_at desc);
create index product_proposals_product_idx on public.product_proposals (product_id);

-- ---------- Audita vēsture (tikai pievienošana) ----------------------------------------

create table public.audit_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- >>>>>>>>>> migrācija: 20260901000300_functions_and_triggers.sql
-- =============================================================================
-- 03: palīgfunkcijas (lomas / tiesības), trigeri, audita vēsture
-- Kļūdu paziņojumi datubāzē ir koda formā (VT_*); lietotnē tie tiek tulkoti latviski.
-- =============================================================================

-- ---------- Universāli trigeri ---------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_product_normalized()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.name_normalized := public.normalize_text(new.name);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.created_by is null then
      new.created_by := auth.uid();
    end if;
    if new.approval_status = 'approved' and new.approved_at is null then
      new.approved_at := now();
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;
  elsif new.approval_status = 'approved' and old.approval_status <> 'approved' then
    new.approved_at := now();
    new.approved_by := coalesce(auth.uid(), new.approved_by);
  end if;
  return new;
end;
$$;

create or replace function public.set_alias_normalized()
returns trigger
language plpgsql
as $$
begin
  new.alias := regexp_replace(btrim(new.alias), '\s+', ' ', 'g');
  new.alias_normalized := public.normalize_text(new.alias);
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

-- ---------- Lomu palīgfunkcijas ------------------------------------------------------------
-- SECURITY DEFINER, lai RLS politikas neveidotu rekursiju. Neaktīvam lietotājam loma = NULL.

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select ur.role
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.is_active
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'sysadmin'), false)
$$;

create or replace function public.is_sysadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'sysadmin', false)
$$;

-- Vai pašreizējais lietotājs drīkst skatīt konkrēta pedagoga pieteikumus
create or replace function public.can_view_owner(p_owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_app_role();
begin
  if v_role is null or p_owner is null then
    return false;
  end if;
  if v_role in ('admin', 'sysadmin') or p_owner = auth.uid() then
    return true;
  end if;
  return exists (
    select 1 from public.teacher_access_grants g
    where g.owner_id = p_owner and g.grantee_id = auth.uid()
  );
end;
$$;

create or replace function public.can_view_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_owner((select r.teacher_id from public.requests r where r.id = p_request_id))
$$;

-- Vai pašreizējais lietotājs drīkst labot pieteikumu:
--   administrators — vienmēr;
--   pedagogs (īpašnieks vai ar labošanas tiesībām) — melnrakstu vienmēr,
--   iesniegtu pieteikumu — kamēr periods ir atvērts un termiņš nav beidzies.
create or replace function public.can_edit_request(p_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_app_role();
  r record;
begin
  if v_role is null then
    return false;
  end if;
  select rq.teacher_id, rq.status, op.status as pstatus, op.submission_deadline as deadline
    into r
  from public.requests rq
  left join public.order_periods op on op.id = rq.period_id
  where rq.id = p_request_id;
  if not found then
    return false;
  end if;
  if v_role in ('admin', 'sysadmin') then
    return true;
  end if;
  if r.teacher_id <> auth.uid() then
    if not exists (
      select 1 from public.teacher_access_grants g
      where g.owner_id = r.teacher_id and g.grantee_id = auth.uid() and g.can_edit
    ) then
      return false;
    end if;
  end if;
  if r.status = 'draft' then
    return true;
  end if;
  if r.status = 'submitted' then
    return r.pstatus = 'open' and now() <= r.deadline;
  end if;
  return false;
end;
$$;

-- ---------- Jauna lietotāja profils ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'teacher') on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Vismaz vienam aktīvam sistēmas administratoram vienmēr jāpaliek
create or replace function public.guard_last_sysadmin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if tg_table_name = 'user_roles' then
    if old.role = 'sysadmin' and (tg_op = 'DELETE' or new.role <> 'sysadmin') then
      v_uid := old.user_id;
    end if;
  elsif tg_table_name = 'profiles' then
    if old.is_active and not new.is_active
       and exists (select 1 from public.user_roles where user_id = old.id and role = 'sysadmin') then
      v_uid := old.id;
    end if;
  end if;
  if v_uid is not null and not exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.role = 'sysadmin' and p.is_active and ur.user_id <> v_uid
  ) then
    raise exception 'VT_LAST_SYSADMIN';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger user_roles_guard_last_sysadmin
  before update or delete on public.user_roles
  for each row execute function public.guard_last_sysadmin();
create trigger profiles_guard_last_sysadmin
  before update on public.profiles
  for each row execute function public.guard_last_sysadmin();

-- ---------- Audita vēsture ----------------------------------------------------------------------
-- Tikai iekšējai lietošanai: EXECUTE tiesības netiek piešķirtas lietotāju lomām (skat. RLS migrāciju).

create or replace function public.audit_insert(
  p_action text, p_entity_type text, p_entity_id text, p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
begin
  if v_actor is not null then
    select full_name into v_name from public.profiles where id = v_actor;
  end if;
  insert into public.audit_log (actor_id, actor_name, action, entity_type, entity_id, details)
  values (v_actor, coalesce(v_name, case when v_actor is null then 'Sistēma' end), p_action, p_entity_type, p_entity_id,
          coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Vispārīgs trigeris: ieraksta, kas un kā mainīts
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j_old jsonb;
  j_new jsonb;
  v_row jsonb;
  v_changed jsonb;
  v_id text;
  v_label text;
  v_skip text[] := array['updated_at', 'last_edited_by', 'name_normalized', 'alias_normalized'];
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  v_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'key',
                   concat_ws('/', v_row ->> 'owner_id', v_row ->> 'grantee_id'));
  v_label := coalesce(v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'alias', v_row ->> 'code',
                      v_row ->> 'proposed_name', v_row ->> 'key');
  if tg_op = 'INSERT' then
    perform public.audit_insert('insert', tg_table_name, v_id,
      jsonb_build_object('label', v_label, 'new', v_row - v_skip));
  elsif tg_op = 'UPDATE' then
    j_old := to_jsonb(old);
    j_new := v_row;
    select jsonb_object_agg(k, jsonb_build_object('old', j_old -> k, 'new', j_new -> k))
      into v_changed
    from jsonb_object_keys(j_new) k
    where (j_old -> k) is distinct from (j_new -> k) and k <> all (v_skip);
    if v_changed is null then
      return null;
    end if;
    perform public.audit_insert('update', tg_table_name, v_id,
      jsonb_build_object('label', v_label, 'changes', v_changed));
  else
    perform public.audit_insert('delete', tg_table_name, v_id,
      jsonb_build_object('label', v_label, 'old', v_row - v_skip));
  end if;
  return null;
end;
$$;

-- Pieteikumi: nereģistrē melnrakstu autosaglabāšanu; reģistrē statusa maiņas,
-- izmaiņas pēc iesniegšanas un dzēšanu.
create or replace function public.audit_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed jsonb;
  v_skip text[] := array['updated_at', 'last_edited_by', 'submitted_at', 'status'];
begin
  if tg_op = 'DELETE' then
    perform public.audit_insert('delete', 'requests', old.id::text,
      jsonb_build_object('request_no', old.request_no, 'teacher_id', old.teacher_id, 'topic', old.topic, 'status', old.status));
  elsif old.status is distinct from new.status then
    perform public.audit_insert('status_change', 'requests', new.id::text,
      jsonb_build_object('request_no', new.request_no, 'topic', new.topic,
                         'from', old.status, 'to', new.status, 'submitted_at', new.submitted_at));
  elsif old.status <> 'draft' then
    select jsonb_object_agg(k, jsonb_build_object('old', to_jsonb(old) -> k, 'new', to_jsonb(new) -> k))
      into v_changed
    from jsonb_object_keys(to_jsonb(new)) k
    where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) and k <> all (v_skip);
    if v_changed is not null then
      perform public.audit_insert('update', 'requests', new.id::text,
        jsonb_build_object('request_no', new.request_no, 'topic', new.topic, 'changes', v_changed));
    end if;
  end if;
  return null;
end;
$$;

-- Pieteikuma rindas: reģistrē izmaiņas tikai tad, ja pieteikums jau nav melnraksts
create or replace function public.audit_request_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.request_items;
  v_req public.requests;
  v_pname text;
  v_unit text;
  v_action text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select * into v_req from public.requests where id = v_row.request_id;
  if not found or v_req.status = 'draft' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and old.product_id = new.product_id
     and old.quantity is not distinct from new.quantity
     and old.unit_id = new.unit_id
     and old.notes is not distinct from new.notes then
    return null;
  end if;
  select name into v_pname from public.products where id = v_row.product_id;
  select code into v_unit from public.units where id = v_row.unit_id;
  v_action := 'item_' || lower(tg_op);
  perform public.audit_insert(v_action, 'requests', v_row.request_id::text,
    jsonb_build_object(
      'request_no', v_req.request_no,
      'product_id', v_row.product_id,
      'product', v_pname,
      'unit', v_unit,
      'quantity', case when tg_op = 'UPDATE'
                       then jsonb_build_object('old', old.quantity, 'new', new.quantity)
                       else to_jsonb(v_row.quantity) end,
      'old_product_id', case when tg_op = 'UPDATE' and old.product_id <> new.product_id then old.product_id end
    ));
  return null;
end;
$$;

-- Audita ieraksti nav labojami vai dzēšami
create or replace function public.audit_log_block()
returns trigger
language plpgsql
as $$
begin
  raise exception 'VT_AUDIT_IMMUTABLE';
end;
$$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.audit_log_block();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_block();

-- ---------- Trigeru piesaiste ---------------------------------------------------------------------

create trigger products_before_write
  before insert or update on public.products
  for each row execute function public.set_product_normalized();
create trigger product_aliases_before_write
  before insert or update on public.product_aliases
  for each row execute function public.set_alias_normalized();

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger order_periods_updated_at before update on public.order_periods
  for each row execute function public.set_updated_at();
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();
create trigger user_roles_updated_at before update on public.user_roles
  for each row execute function public.set_updated_at();

-- Audita trigeri (AFTER, lai reģistrētu tikai veiksmīgas izmaiņas)
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.audit_row_change();
create trigger audit_product_aliases after insert or update or delete on public.product_aliases
  for each row execute function public.audit_row_change();
create trigger audit_product_proposals after update on public.product_proposals
  for each row execute function public.audit_row_change();
create trigger audit_order_periods after insert or update or delete on public.order_periods
  for each row execute function public.audit_row_change();
create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change();
create trigger audit_profiles after update on public.profiles
  for each row execute function public.audit_row_change();
create trigger audit_groups after insert or update or delete on public.groups
  for each row execute function public.audit_row_change();
create trigger audit_courses after insert or update or delete on public.courses
  for each row execute function public.audit_row_change();
create trigger audit_categories after insert or update or delete on public.product_categories
  for each row execute function public.audit_row_change();
create trigger audit_units after insert or update or delete on public.units
  for each row execute function public.audit_row_change();
create trigger audit_grants after insert or update or delete on public.teacher_access_grants
  for each row execute function public.audit_row_change();
create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function public.audit_row_change();
create trigger audit_requests after update or delete on public.requests
  for each row execute function public.audit_request_change();
create trigger audit_request_items after insert or update or delete on public.request_items
  for each row execute function public.audit_request_item_change();

-- ---------- Pieteikuma biznesa noteikumi ------------------------------------------------------------

create or replace function public.requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_period public.order_periods;
  v_errors text[] := '{}';
  v_items integer;
  v_bad integer;
  v_leaving_draft boolean := false;
begin
  -- Ierobežojumi pedagogiem (administratora un sistēmas darbībām tie neattiecas)
  if v_uid is not null and not v_admin then
    if tg_op = 'INSERT' then
      if new.teacher_id <> v_uid then
        raise exception 'VT_FORBIDDEN';
      end if;
      if new.status <> 'draft' then
        raise exception 'VT_FORBIDDEN_STATUS';
      end if;
    else
      if new.teacher_id <> old.teacher_id then
        raise exception 'VT_FORBIDDEN';
      end if;
      if new.status <> old.status
         and not ((old.status = 'draft' and new.status in ('submitted', 'cancelled'))
               or (old.status = 'submitted' and new.status = 'cancelled')) then
        raise exception 'VT_FORBIDDEN_STATUS';
      end if;
      new.submitted_at := old.submitted_at;
    end if;
    if new.period_id is not null and (tg_op = 'INSERT' or new.period_id is distinct from old.period_id) then
      select * into v_period from public.order_periods where id = new.period_id;
      if not found or v_period.status <> 'open' or now() > v_period.submission_deadline then
        raise exception 'VT_PERIOD_CLOSED';
      end if;
    end if;
  end if;

  -- Aktīva pieteikuma (nav melnraksts / atcelts) obligātie lauki jābūt aizpildītiem ne tikai iesniedzot,
  -- bet arī pēc jebkuras turpmākas labošanas (arī tiešā PATCH pieprasījumā).
  if tg_op = 'UPDATE' and new.status not in ('draft', 'cancelled') then
    v_leaving_draft := old.status = 'draft';
    if btrim(coalesce(new.topic, '')) = '' then
      v_errors := array_append(v_errors, 'NO_TOPIC');
    end if;
    if new.lesson_date is null then
      v_errors := array_append(v_errors, 'NO_DATE');
    end if;
    if new.period_id is null then
      v_errors := array_append(v_errors, 'NO_PERIOD');
    elsif v_leaving_draft and v_uid is not null and not v_admin then
      select * into v_period from public.order_periods where id = new.period_id;
      if v_period.status <> 'open' or now() > v_period.submission_deadline then
        v_errors := array_append(v_errors, 'PERIOD_CLOSED');
      end if;
    end if;
    if v_leaving_draft then
      select count(*), count(*) filter (where quantity is null or quantity <= 0)
        into v_items, v_bad
      from public.request_items where request_id = new.id;
      if v_items = 0 then
        v_errors := array_append(v_errors, 'NO_ITEMS');
      elsif v_bad > 0 then
        v_errors := array_append(v_errors, 'BAD_QTY');
      end if;
    end if;
    if array_length(v_errors, 1) > 0 then
      raise exception 'VT_SUBMIT_INVALID' using detail = array_to_string(v_errors, ',');
    end if;
    if v_leaving_draft then
      if new.status = 'submitted' then
        new.submitted_at := now();
      else
        new.submitted_at := coalesce(new.submitted_at, now());
      end if;
    end if;
  end if;

  new.updated_at := now();
  new.last_edited_by := v_uid;
  return new;
end;
$$;

create trigger requests_before_write
  before insert or update on public.requests
  for each row execute function public.requests_guard();

create or replace function public.request_items_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.products;
  v_status public.request_status;
  v_uid uuid := auth.uid();
begin
  -- Neaktīvu, noraidītu vai apvienotu produktu nedrīkst izvēlēties jaunai rindai
  if tg_op = 'INSERT' or new.product_id is distinct from old.product_id then
    select * into v_prod from public.products where id = new.product_id;
    if not found or not v_prod.is_active or v_prod.merged_into is not null
       or v_prod.approval_status = 'rejected' then
      raise exception 'VT_PRODUCT_INACTIVE';
    end if;
    if v_prod.approval_status = 'pending' and v_uid is not null
       and not public.is_admin() and v_prod.created_by is distinct from v_uid then
      raise exception 'VT_PRODUCT_INACTIVE';
    end if;
  end if;
  select status into v_status from public.requests where id = new.request_id;
  if v_status is distinct from 'draft' and new.quantity is null then
    raise exception 'VT_BAD_QTY';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger request_items_before_write
  before insert or update on public.request_items
  for each row execute function public.request_items_guard();

-- Aktīva (nav melnraksts / atcelts) pieteikuma rindu kopa nedrīkst kļūt nederīga: jābūt vismaz vienai rindai un visiem daudzumiem > 0.
-- Pārbaude ir atlikta līdz transakcijas beigām, lai atomāra rindu sinhronizācija (save_request) varētu pagaidu stāvoklī dzēst/pievienot rindas.
create or replace function public.request_items_final_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rid uuid := coalesce(new.request_id, old.request_id);
  v_status public.request_status;
  v_count integer;
  v_bad integer;
begin
  select status into v_status from public.requests where id = v_rid;
  if not found or v_status in ('draft', 'cancelled') then
    return null;
  end if;
  select count(*), count(*) filter (where quantity is null or quantity <= 0)
    into v_count, v_bad
  from public.request_items where request_id = v_rid;
  if v_count = 0 then
    raise exception 'VT_SUBMIT_INVALID' using detail = 'NO_ITEMS';
  elsif v_bad > 0 then
    raise exception 'VT_SUBMIT_INVALID' using detail = 'BAD_QTY';
  end if;
  return null;
end;
$$;

create constraint trigger request_items_final_check
  after insert or update or delete on public.request_items
  deferrable initially deferred
  for each row execute function public.request_items_final_check();

-- >>>>>>>>>> migrācija: 20260901000400_row_level_security.sql
-- =============================================================================
-- 04: Row Level Security un tabulu tiesības
-- Princips: viss ir slēgts pēc noklusējuma; piekļuvi dod tikai skaidras politikas.
-- Anonīmai lomai (anon) netiek piešķirtas nekādas tiesības.
-- =============================================================================

alter table public.units                 enable row level security;
alter table public.product_categories    enable row level security;
alter table public.courses               enable row level security;
alter table public.groups                enable row level security;
alter table public.app_settings          enable row level security;
alter table public.profiles              enable row level security;
alter table public.user_roles            enable row level security;
alter table public.teacher_access_grants enable row level security;
alter table public.order_periods         enable row level security;
alter table public.products              enable row level security;
alter table public.product_aliases       enable row level security;
alter table public.product_proposals     enable row level security;
alter table public.requests              enable row level security;
alter table public.request_items         enable row level security;
alter table public.audit_log             enable row level security;

-- ---------- Tabulu tiesības (RLS filtrē rindas) -------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;

grant select, insert, update, delete on
  public.units, public.product_categories, public.courses, public.groups, public.app_settings,
  public.profiles, public.user_roles, public.teacher_access_grants, public.order_periods,
  public.products, public.product_aliases, public.product_proposals,
  public.requests, public.request_items
  to authenticated;
grant select on public.audit_log to authenticated;
grant all on all tables in schema public to service_role;

-- ---------- Atsauces dati: lasa visi aktīvie lietotāji ---------------------------------------------------

create policy units_select on public.units
  for select to authenticated using ((select public.current_app_role()) is not null);
create policy units_write on public.units
  for all to authenticated using ((select public.is_sysadmin())) with check ((select public.is_sysadmin()));

create policy categories_select on public.product_categories
  for select to authenticated using ((select public.current_app_role()) is not null);
create policy categories_write on public.product_categories
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy courses_select on public.courses
  for select to authenticated using ((select public.current_app_role()) is not null);
create policy courses_write on public.courses
  for all to authenticated using ((select public.is_sysadmin())) with check ((select public.is_sysadmin()));

create policy groups_select on public.groups
  for select to authenticated using ((select public.current_app_role()) is not null);
create policy groups_write on public.groups
  for all to authenticated using ((select public.is_sysadmin())) with check ((select public.is_sysadmin()));

create policy app_settings_select on public.app_settings
  for select to authenticated using ((select public.current_app_role()) is not null);
create policy app_settings_write on public.app_settings
  for all to authenticated using ((select public.is_sysadmin())) with check ((select public.is_sysadmin()));

-- ---------- Lietotāji ---------------------------------------------------------------------------------------

-- Katrs redz savu profilu (arī deaktivizēts, lai varētu parādīt paziņojumu);
-- administratori redz visus; pedagogs redz to pedagogu vārdus, kuru pieteikumiem viņam dotas tiesības.
create policy profiles_select on public.profiles
  for select to authenticated using (
    id = (select auth.uid())
    or (select public.is_admin())
    or (
      (select public.current_app_role()) is not null
      and exists (
        select 1 from public.teacher_access_grants g
        where g.owner_id = profiles.id and g.grantee_id = (select auth.uid())
      )
    )
  );
-- Profilus (vārdu, aktivitāti) maina tikai sistēmas administrators; pedagogs — caur update_own_profile()
create policy profiles_update on public.profiles
  for update to authenticated using ((select public.is_sysadmin())) with check ((select public.is_sysadmin()));

create policy user_roles_select on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy user_roles_write on public.user_roles
  for all to authenticated using ((select public.is_sysadmin())) with check ((select public.is_sysadmin()));

create policy grants_select on public.teacher_access_grants
  for select to authenticated using (
    (select public.is_admin()) or owner_id = (select auth.uid()) or grantee_id = (select auth.uid())
  );
create policy grants_write on public.teacher_access_grants
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- Periodi -----------------------------------------------------------------------------------------------

create policy periods_select on public.order_periods
  for select to authenticated using ((select public.current_app_role()) is not null);
create policy periods_write on public.order_periods
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- Produktu katalogs ---------------------------------------------------------------------------------------

-- Apstiprinātas preces redz visi; neapstiprinātu (ierosinātu) redz tikai tās autors un administratori
create policy products_select on public.products
  for select to authenticated using (
    (select public.current_app_role()) is not null
    and (approval_status = 'approved' or created_by = (select auth.uid()) or (select public.is_admin()))
  );
create policy products_insert_admin on public.products
  for insert to authenticated with check ((select public.is_admin()));
create policy products_insert_teacher on public.products
  for insert to authenticated with check (
    (select public.current_app_role()) is not null
    and created_by = (select auth.uid())
    and approval_status = 'pending'
    and merged_into is null
  );
create policy products_update on public.products
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy products_delete on public.products
  for delete to authenticated using ((select public.is_admin()));

create policy aliases_select on public.product_aliases
  for select to authenticated using ((select public.current_app_role()) is not null);
create policy aliases_write on public.product_aliases
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy proposals_select on public.product_proposals
  for select to authenticated using (proposed_by = (select auth.uid()) or (select public.is_admin()));
create policy proposals_insert on public.product_proposals
  for insert to authenticated with check (
    (select public.current_app_role()) is not null
    and proposed_by = (select auth.uid())
    and status = 'pending'
  );
create policy proposals_update on public.product_proposals
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- Pieteikumi -------------------------------------------------------------------------------------------------

create policy requests_select on public.requests
  for select to authenticated using (public.can_view_owner(teacher_id));
create policy requests_insert on public.requests
  for insert to authenticated with check (
    (select public.is_admin())
    or ((select public.current_app_role()) is not null and teacher_id = (select auth.uid()))
  );
create policy requests_update on public.requests
  for update to authenticated
  using (public.can_edit_request(id))
  with check (public.can_view_owner(teacher_id));
-- Dzēst drīkst melnrakstu (īpašnieks); administrators — jebkuru
create policy requests_delete on public.requests
  for delete to authenticated using (
    (select public.is_admin())
    or ((select public.current_app_role()) is not null
        and teacher_id = (select auth.uid())
        and status = 'draft')
  );

create policy request_items_select on public.request_items
  for select to authenticated using ((select public.is_admin()) or public.can_view_request(request_id));
create policy request_items_insert on public.request_items
  for insert to authenticated with check (public.can_edit_request(request_id));
create policy request_items_update on public.request_items
  for update to authenticated using (public.can_edit_request(request_id)) with check (public.can_edit_request(request_id));
create policy request_items_delete on public.request_items
  for delete to authenticated using (public.can_edit_request(request_id));

-- ---------- Audita vēsture: tikai administratoru lasīšana ---------------------------------------------------------------

create policy audit_log_select on public.audit_log
  for select to authenticated using ((select public.is_admin()));

-- >>>>>>>>>> migrācija: 20260901000500_rpc_functions.sql
-- =============================================================================
-- 05: RPC funkcijas — meklēšana, pieteikumu saglabāšana, apkopošana, kataloga darbības
-- Visas funkcijas ir SECURITY INVOKER (izpildās ar lietotāja tiesībām, tātad RLS ir spēkā),
-- izņemot update_own_profile.
-- =============================================================================

-- ---------- Preču meklēšana (typeahead) -------------------------------------------------------------------------------
-- Meklē pēc nosaukuma fragmenta, bez reģistrjutības un bez diakritiskajām zīmēm, pēc sinonīmiem (alias),
-- ar iecietību pret drukas kļūdām. Ranžē: precīza sakritība > sākas ar > vārda sākums > satur > alias > neskaidra.
-- Neapvieno produktus — atgriež katru product_id atsevišķi.

create or replace function public.search_products(p_query text, p_limit integer default 12)
returns table (
  id uuid,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_code text,
  base_unit_id uuid,
  base_unit_code text,
  package_description text,
  package_quantity numeric,
  approval_status public.approval_status,
  matched_alias text
)
language sql
stable
set search_path = public, extensions
as $$
  with params as (
    select public.normalize_text(p_query) as q,
           string_to_array(public.normalize_text(p_query), ' ') as tokens,
           least(greatest(coalesce(p_limit, 12), 1), 50) as lim
  ),
  strict_hits as (
    select p.id as pid, null::text as via,
           case when p.name_normalized = pa.q then 0
                when p.name_normalized like public.escape_like(pa.q) || '%' then 1
                when p.name_normalized like '% ' || public.escape_like(pa.q) || '%' then 2
                else 3 end as tier,
           similarity(p.name_normalized, pa.q) as sim
    from params pa, public.products p
    where pa.q <> ''
      and p.is_active and p.merged_into is null and p.approval_status <> 'rejected'
      and p.name_normalized like '%' || public.escape_like(pa.tokens[1]) || '%'
      and not exists (
        select 1 from unnest(pa.tokens) t
        where p.name_normalized not like '%' || public.escape_like(t) || '%'
      )
    union all
    -- sinonīms: precīza sakritība ir spēcīga (1), citas — pēc nosaukuma sakritībām (4)
    select a.product_id, a.alias,
           case when a.alias_normalized = pa.q then 1 else 4 end,
           similarity(a.alias_normalized, pa.q)
    from params pa, public.product_aliases a
    join public.products p on p.id = a.product_id
    where pa.q <> ''
      and p.is_active and p.merged_into is null and p.approval_status <> 'rejected'
      and a.alias_normalized like '%' || public.escape_like(pa.tokens[1]) || '%'
      and not exists (
        select 1 from unnest(pa.tokens) t
        where a.alias_normalized not like '%' || public.escape_like(t) || '%'
      )
  ),
  -- Neskaidrā meklēšana (drukas kļūdas): tikai no 4 simboliem un tikai ja nav precīzu rezultātu
  fuzzy_hits as (
    select p.id as pid, null::text as via, 5 as tier, similarity(p.name_normalized, pa.q) as sim
    from params pa, public.products p
    where length(pa.q) >= 4
      and not exists (select 1 from strict_hits)
      and p.is_active and p.merged_into is null and p.approval_status <> 'rejected'
      and p.name_normalized % pa.q
    union all
    select a.product_id, a.alias, 6, similarity(a.alias_normalized, pa.q)
    from params pa, public.product_aliases a
    join public.products p on p.id = a.product_id
    where length(pa.q) >= 4
      and not exists (select 1 from strict_hits)
      and p.is_active and p.merged_into is null and p.approval_status <> 'rejected'
      and a.alias_normalized % pa.q
  ),
  hits as (
    select * from strict_hits
    union all
    select * from fuzzy_hits
  ),
  best as (
    select distinct on (h.pid) h.pid, h.via, h.tier, h.sim
    from hits h
    order by h.pid, h.tier, h.sim desc
  )
  select p.id, p.name, p.category_id, c.name, p.order_unit_id, u.code, p.base_unit_id, bu.code,
         p.package_description, p.package_quantity, p.approval_status, b.via
  from best b
  join public.products p on p.id = b.pid
  join public.units u on u.id = p.order_unit_id
  join public.units bu on bu.id = p.base_unit_id
  left join public.product_categories c on c.id = p.category_id
  order by b.tier, length(p.name), b.sim desc, p.name
  limit (select lim from params)
$$;

-- ---------- Kataloga saraksts (lapošana + filtri) --------------------------------------------------------------------------------

create or replace function public.list_products(
  p_query text default null,
  p_category_id uuid default null,
  p_status text default 'all',          -- all | active | inactive
  p_approval text default null,         -- pending | approved | rejected | null
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  category_id uuid,
  category_name text,
  base_unit_id uuid,
  base_unit_code text,
  order_unit_id uuid,
  order_unit_code text,
  package_description text,
  package_quantity numeric,
  barcode text,
  notes text,
  is_active boolean,
  approval_status public.approval_status,
  aliases text[],
  total_count bigint
)
language sql
stable
set search_path = public, extensions
as $$
  with params as (
    select public.normalize_text(p_query) as q,
           string_to_array(public.normalize_text(p_query), ' ') as tokens
  ),
  filtered as (
    select p.*
    from params pa, public.products p
    where p.merged_into is null
      and (p_category_id is null or p.category_id = p_category_id)
      and (p_status = 'all' or (p_status = 'active' and p.is_active) or (p_status = 'inactive' and not p.is_active))
      and (p_approval is null or p_approval = '' or p.approval_status::text = p_approval)
      and (
        pa.q = ''
        or (
          not exists (
            select 1 from unnest(pa.tokens) t
            where p.name_normalized not like '%' || public.escape_like(t) || '%'
          )
        )
        or exists (
          select 1 from public.product_aliases a
          where a.product_id = p.id
            and not exists (
              select 1 from unnest(pa.tokens) t
              where a.alias_normalized not like '%' || public.escape_like(t) || '%'
            )
        )
      )
  )
  select f.id, f.name, f.category_id, c.name, f.base_unit_id, bu.code, f.order_unit_id, ou.code,
         f.package_description, f.package_quantity, f.barcode, f.notes, f.is_active, f.approval_status,
         coalesce((select array_agg(a.alias order by a.alias) from public.product_aliases a where a.product_id = f.id), '{}'),
         count(*) over ()
  from filtered f
  join public.units bu on bu.id = f.base_unit_id
  join public.units ou on ou.id = f.order_unit_id
  left join public.product_categories c on c.id = f.category_id
  order by f.name_normalized, f.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ---------- Pieteikuma saglabāšana (atomāri) --------------------------------------------------------------------------------------------
-- p_data:  { period_id, course_id, group_id, students, topic, lesson_date, student_count, notes, expected_updated_at? }
-- p_items: [ { id?, product_id, unit_id, quantity (teksts vai null), notes } ]  — masīva secība = Npk.
--          NULL = rindas netiek aiztiktas; masīvs = pilna rindu kopa (trūkstošās rindas tiek dzēstas).
-- Rindas bez product_id netiek saglabātas (tās paliek tikai lietotāja formā).
-- expected_updated_at: optimistiskā bloķēšana — ja pieteikums starplaikā mainīts (cits logs / cits lietotājs), tiek atgriezts VT_CONFLICT.

create or replace function public.save_request(p_id uuid, p_data jsonb, p_items jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_row public.requests;
  v_pos integer := 0;
  v_item jsonb;
  v_item_id uuid;
  v_ids uuid[] := '{}';
  v_current timestamptz;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'VT_INVALID';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'VT_INVALID';
  end if;

  if v_id is null then
    insert into public.requests (teacher_id, period_id, course_id, group_id, students, topic, lesson_date, student_count, notes)
    values (
      auth.uid(),
      nullif(p_data ->> 'period_id', '')::uuid,
      nullif(p_data ->> 'course_id', '')::uuid,
      nullif(p_data ->> 'group_id', '')::uuid,
      nullif(btrim(p_data ->> 'students'), ''),
      coalesce(btrim(p_data ->> 'topic'), ''),
      nullif(p_data ->> 'lesson_date', '')::date,
      nullif(p_data ->> 'student_count', '')::integer,
      nullif(btrim(p_data ->> 'notes'), '')
    )
    returning * into v_row;
    v_id := v_row.id;
  else
    if nullif(p_data ->> 'expected_updated_at', '') is not null then
      select updated_at into v_current from public.requests where id = v_id for update;
      if found and v_current <> (p_data ->> 'expected_updated_at')::timestamptz then
        raise exception 'VT_CONFLICT';
      end if;
    end if;
    update public.requests set
      period_id = nullif(p_data ->> 'period_id', '')::uuid,
      course_id = nullif(p_data ->> 'course_id', '')::uuid,
      group_id = nullif(p_data ->> 'group_id', '')::uuid,
      students = nullif(btrim(p_data ->> 'students'), ''),
      topic = coalesce(btrim(p_data ->> 'topic'), ''),
      lesson_date = nullif(p_data ->> 'lesson_date', '')::date,
      student_count = nullif(p_data ->> 'student_count', '')::integer,
      notes = nullif(btrim(p_data ->> 'notes'), '')
    where id = v_id
    returning * into v_row;
    if not found then
      if exists (select 1 from public.requests where id = v_id) then
        raise exception 'VT_LOCKED';
      end if;
      raise exception 'VT_NOT_FOUND';
    end if;
  end if;

  if p_items is not null then
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      if nullif(v_item ->> 'product_id', '') is null then
        continue;
      end if;
      v_pos := v_pos + 1;
      v_item_id := coalesce(nullif(v_item ->> 'id', '')::uuid, gen_random_uuid());
      if exists (select 1 from public.request_items where id = v_item_id and request_id = v_id) then
        update public.request_items set
          position = v_pos,
          product_id = (v_item ->> 'product_id')::uuid,
          quantity = nullif(v_item ->> 'quantity', '')::numeric,
          unit_id = (v_item ->> 'unit_id')::uuid,
          notes = nullif(btrim(v_item ->> 'notes'), '')
        where id = v_item_id;
      else
        insert into public.request_items (id, request_id, position, product_id, quantity, unit_id, notes)
        values (
          v_item_id, v_id, v_pos,
          (v_item ->> 'product_id')::uuid,
          nullif(v_item ->> 'quantity', '')::numeric,
          (v_item ->> 'unit_id')::uuid,
          nullif(btrim(v_item ->> 'notes'), '')
        );
      end if;
      v_ids := v_ids || v_item_id;
    end loop;

    delete from public.request_items where request_id = v_id and id <> all (v_ids);
  end if;

  select * into v_row from public.requests where id = v_id;
  return jsonb_build_object(
    'id', v_row.id,
    'request_no', v_row.request_no,
    'status', v_row.status,
    'updated_at', v_row.updated_at,
    'item_ids', to_jsonb(v_ids)
  );
end;
$$;

create or replace function public.submit_request(p_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_row public.requests;
begin
  update public.requests set status = 'submitted'
  where id = p_id and status = 'draft'
  returning * into v_row;
  if not found then
    select * into v_row from public.requests where id = p_id;
    if not found then
      raise exception 'VT_NOT_FOUND';
    end if;
    if v_row.status <> 'draft' then
      raise exception 'VT_ALREADY_SUBMITTED';
    end if;
    raise exception 'VT_LOCKED';
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'submitted_at', v_row.submitted_at);
end;
$$;

-- Pieteikuma kopēšana: izveido JAUNU melnrakstu; oriģināls netiek mainīts.
-- Datums netiek pārnests (pedagogam jānorāda jauns). Neaktīvās preces netiek kopētas.
create or replace function public.copy_request(p_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_src public.requests;
  v_new uuid;
  v_total integer;
  v_copied integer;
begin
  select * into v_src from public.requests where id = p_id;
  if not found then
    raise exception 'VT_NOT_FOUND';
  end if;
  insert into public.requests (teacher_id, course_id, group_id, students, topic, lesson_date, student_count, notes, status)
  values (auth.uid(), v_src.course_id, v_src.group_id, v_src.students, v_src.topic, null, v_src.student_count, v_src.notes, 'draft')
  returning id into v_new;

  select count(*) into v_total from public.request_items where request_id = p_id;

  insert into public.request_items (request_id, position, product_id, quantity, unit_id, notes)
  select v_new, row_number() over (order by i.position, i.created_at), i.product_id, i.quantity, i.unit_id, i.notes
  from public.request_items i
  join public.products p on p.id = i.product_id
  where i.request_id = p_id
    and p.is_active and p.merged_into is null and p.approval_status <> 'rejected'
    and (p.approval_status = 'approved' or p.created_by = auth.uid() or public.is_admin());
  get diagnostics v_copied = row_count;

  return jsonb_build_object('id', v_new, 'copied', v_copied, 'skipped', v_total - v_copied);
end;
$$;

-- ---------- Kopējais pasūtījums --------------------------------------------------------------------------------------------------------------
-- order_lines: viena rinda = viena pieteikuma rinda (ar visu kontekstu). Visi pārējie skati tiek aprēķināti no tās,
-- tāpēc kopsumma vienmēr ir auditējama līdz sākotnējiem pieteikumiem.
-- Noklusējuma statusi: iesniegts, apstiprināts, iekļauts pasūtījumā, pasūtīts (bez melnrakstiem un atceltajiem).

create or replace function public.order_lines(
  p_period_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_teacher_id uuid default null,
  p_group_id uuid default null,
  p_course_id uuid default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_statuses public.request_status[] default null,
  p_topic text default null
)
returns table (
  item_id uuid,
  request_id uuid,
  request_no bigint,
  request_status public.request_status,
  period_id uuid,
  teacher_id uuid,
  teacher_name text,
  course_id uuid,
  course_name text,
  group_id uuid,
  group_name text,
  students text,
  topic text,
  lesson_date date,
  student_count integer,
  request_notes text,
  product_id uuid,
  product_name text,
  category_id uuid,
  category_name text,
  category_sort integer,
  approval_status public.approval_status,
  product_active boolean,
  base_unit_id uuid,
  order_unit_id uuid,
  package_quantity numeric,
  unit_id uuid,
  unit_code text,
  quantity numeric,
  item_notes text,
  item_position integer
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'VT_FORBIDDEN';
  end if;
  return query
  select i.id, r.id, r.request_no, r.status, r.period_id, r.teacher_id, t.full_name,
         r.course_id, c.name, r.group_id, g.name, r.students, r.topic, r.lesson_date, r.student_count, r.notes,
         p.id, p.name, p.category_id, pc.name, pc.sort_order, p.approval_status, p.is_active,
         p.base_unit_id, p.order_unit_id, p.package_quantity,
         i.unit_id, u.code, i.quantity, i.notes, i.position
  from public.request_items i
  join public.requests r on r.id = i.request_id
  join public.products p on p.id = i.product_id
  join public.units u on u.id = i.unit_id
  join public.profiles t on t.id = r.teacher_id
  left join public.courses c on c.id = r.course_id
  left join public.groups g on g.id = r.group_id
  left join public.product_categories pc on pc.id = p.category_id
  where i.quantity is not null and i.quantity > 0
    and r.status = any (coalesce(p_statuses, array['submitted', 'approved', 'included', 'ordered']::public.request_status[]))
    and (p_period_id is null or r.period_id = p_period_id)
    and (p_date_from is null or r.lesson_date >= p_date_from)
    and (p_date_to is null or r.lesson_date <= p_date_to)
    and (p_teacher_id is null or r.teacher_id = p_teacher_id)
    and (p_group_id is null or r.group_id = p_group_id)
    and (p_course_id is null or r.course_id = p_course_id)
    and (p_product_id is null or i.product_id = p_product_id)
    and (p_category_id is null or p.category_id = p_category_id)
    and (p_topic is null or btrim(p_topic) = ''
         or public.normalize_text(r.topic) like '%' || public.escape_like(public.normalize_text(p_topic)) || '%')
  order by r.lesson_date nulls last, t.full_name, r.request_no, i.position, i.id;
end;
$$;

-- Apkopojums pa precēm: grupē pēc product_id UN mērvienības (dažādas mērvienības netiek summētas kopā).
-- Visām atgrieztajām kopām ir deterministiska kārtība, lai tās varētu droši lapot (Supabase API max_rows = 1000).
create or replace function public.get_order_summary(
  p_period_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_teacher_id uuid default null,
  p_group_id uuid default null,
  p_course_id uuid default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_statuses public.request_status[] default null,
  p_topic text default null
)
returns table (
  product_id uuid,
  product_name text,
  category_id uuid,
  category_name text,
  approval_status public.approval_status,
  product_active boolean,
  unit_id uuid,
  unit_code text,
  total_quantity numeric,
  request_count bigint,
  teacher_count bigint,
  group_names text,
  equivalent_quantity numeric,
  equivalent_unit_code text
)
language sql
stable
set search_path = public
as $$
  select l.product_id, l.product_name, l.category_id, l.category_name, l.approval_status, l.product_active,
         l.unit_id, l.unit_code,
         sum(l.quantity),
         count(distinct l.request_id),
         count(distinct l.teacher_id),
         string_agg(distinct l.group_name, ', ' order by l.group_name) filter (where l.group_name is not null),
         case when l.unit_id = l.order_unit_id and l.package_quantity is not null and l.base_unit_id <> l.order_unit_id
              then round(sum(l.quantity) * l.package_quantity, 3) end,
         case when l.unit_id = l.order_unit_id and l.package_quantity is not null and l.base_unit_id <> l.order_unit_id
              then (select bu.code from public.units bu where bu.id = l.base_unit_id) end
  from public.order_lines(p_period_id, p_date_from, p_date_to, p_teacher_id, p_group_id, p_course_id,
                          p_product_id, p_category_id, p_statuses, p_topic) l
  group by l.product_id, l.product_name, l.category_id, l.category_name, l.category_sort, l.approval_status,
           l.product_active, l.unit_id, l.unit_code, l.order_unit_id, l.base_unit_id, l.package_quantity
  order by l.category_sort nulls last, l.category_name nulls last, l.product_name, l.product_id, l.unit_code
$$;

-- Atskaites pa pedagogiem / grupām / kursiem / datumiem / kategorijām (kopsummas pa precēm katrā griezumā)
create or replace function public.get_order_report(
  p_dimension text,
  p_period_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_teacher_id uuid default null,
  p_group_id uuid default null,
  p_course_id uuid default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_statuses public.request_status[] default null,
  p_topic text default null
)
returns table (
  group_key text,
  group_label text,
  product_id uuid,
  product_name text,
  category_name text,
  unit_id uuid,
  unit_code text,
  total_quantity numeric,
  request_count bigint
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_dimension not in ('teacher', 'group', 'course', 'date', 'category') then
    raise exception 'VT_INVALID';
  end if;
  return query
  with l as (
    select x.*,
      case p_dimension
        when 'teacher'  then x.teacher_id::text
        when 'group'    then coalesce(x.group_id::text, '')
        when 'course'   then coalesce(x.course_id::text, '')
        when 'date'     then coalesce(x.lesson_date::text, '')
        when 'category' then coalesce(x.category_id::text, '')
      end as gk,
      case p_dimension
        when 'teacher'  then x.teacher_name
        when 'group'    then coalesce(x.group_name, 'Nenorādīta')
        when 'course'   then coalesce(x.course_name, 'Nenorādīts')
        when 'date'     then coalesce(to_char(x.lesson_date, 'DD.MM.YYYY'), 'Nenorādīts')
        when 'category' then coalesce(x.category_name, 'Bez kategorijas')
      end as gl
    from public.order_lines(p_period_id, p_date_from, p_date_to, p_teacher_id, p_group_id, p_course_id,
                            p_product_id, p_category_id, p_statuses, p_topic) x
  )
  select l.gk, l.gl, l.product_id, l.product_name, l.category_name, l.unit_id, l.unit_code,
         sum(l.quantity), count(distinct l.request_id)
  from l
  group by l.gk, l.gl, l.product_id, l.product_name, l.category_name, l.unit_id, l.unit_code
  order by min(case p_dimension when 'date' then coalesce(l.lesson_date::text, '9999') else lower(l.gl) end),
           l.gk, l.product_name, l.product_id, l.unit_code;
end;
$$;

-- Sākumlapas KPI
create or replace function public.dashboard_stats(p_period_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'VT_FORBIDDEN';
  end if;
  select jsonb_build_object(
    'submitted_requests', (select count(*) from public.requests r
        where r.period_id = p_period_id and r.status in ('submitted', 'approved', 'included', 'ordered')),
    'submitted_teachers', (select count(distinct r.teacher_id) from public.requests r
        where r.period_id = p_period_id and r.status in ('submitted', 'approved', 'included', 'ordered')),
    'unique_products', (select count(distinct (i.product_id)) from public.request_items i
        join public.requests r on r.id = i.request_id
        where r.period_id = p_period_id and r.status in ('submitted', 'approved', 'included', 'ordered')),
    'pending_products', (select count(*) from public.products where approval_status = 'pending'),
    'draft_requests', (select count(*) from public.requests r
        where r.period_id = p_period_id and r.status = 'draft'),
    'included_positions', (select count(*) from public.request_items i
        join public.requests r on r.id = i.request_id
        where r.period_id = p_period_id and r.status in ('included', 'ordered'))
  ) into v_result;
  return v_result;
end;
$$;

-- ---------- Jaunas preces ierosināšana un izskatīšana ---------------------------------------------------------------------------

create or replace function public.propose_product(
  p_name text, p_unit_id uuid, p_category_id uuid default null, p_notes text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_norm text := public.normalize_text(p_name);
  v_exist text;
  v_product public.products;
begin
  if v_name = '' or length(v_name) > 200 then
    raise exception 'VT_INVALID';
  end if;
  -- Sinonīms jau norāda uz esošu preci? Ieteikt to, nevis veidot dublikātu.
  select p.name into v_exist
  from public.product_aliases a join public.products p on p.id = a.product_id
  where a.alias_normalized = v_norm and p.merged_into is null;
  if v_exist is not null then
    raise exception 'VT_DUPLICATE_ALIAS' using detail = v_exist;
  end if;
  begin
    insert into public.products (name, base_unit_id, order_unit_id, category_id, notes, approval_status, created_by)
    values (v_name, p_unit_id, p_unit_id, p_category_id, nullif(btrim(p_notes), ''), 'pending', auth.uid())
    returning * into v_product;
  exception when unique_violation then
    raise exception 'VT_DUPLICATE_NAME';
  end;
  insert into public.product_proposals (product_id, proposed_name, unit_id, category_id, notes, proposed_by)
  values (v_product.id, v_product.name, p_unit_id, p_category_id, nullif(btrim(p_notes), ''), auth.uid());
  return jsonb_build_object('id', v_product.id, 'name', v_product.name);
end;
$$;

-- Produktu apvienošana: kļūdaini izveidoto (source) apvieno ar pareizo (target).
-- Pieteikumu rindas un sinonīmi tiek pārcelti; source tiek deaktivizēts un saglabāts kā vēsture;
-- source nosaukums kļūst par target sinonīmu. Izmaiņas tiek reģistrētas audita vēsturē.
create or replace function public.merge_products(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_src public.products;
  v_tgt public.products;
  v_moved integer;
begin
  if not public.is_admin() then
    raise exception 'VT_FORBIDDEN';
  end if;
  if p_source is null or p_target is null or p_source = p_target then
    raise exception 'VT_INVALID';
  end if;
  select * into v_src from public.products where id = p_source for update;
  select * into v_tgt from public.products where id = p_target for update;
  if v_src.id is null or v_tgt.id is null then
    raise exception 'VT_NOT_FOUND';
  end if;
  if v_tgt.merged_into is not null or v_tgt.approval_status = 'rejected' or v_src.merged_into is not null then
    raise exception 'VT_INVALID';
  end if;

  update public.request_items set product_id = p_target where product_id = p_source;
  get diagnostics v_moved = row_count;

  update public.product_aliases set product_id = p_target where product_id = p_source;
  if public.normalize_text(v_src.name) <> v_tgt.name_normalized then
    insert into public.product_aliases (product_id, alias, created_by)
    values (p_target, v_src.name, auth.uid())
    on conflict (alias_normalized) do nothing;
  end if;

  update public.products set merged_into = p_target, is_active = false where id = p_source;
  update public.products set merged_into = p_target where merged_into = p_source;
  update public.product_proposals
    set status = 'merged', merged_into_product_id = p_target, resolved_by = auth.uid(), resolved_at = now()
    where product_id = p_source and status = 'pending';

  return jsonb_build_object('moved_items', v_moved, 'target_id', p_target);
end;
$$;

-- Ierosinājuma izskatīšana: approve (ar iespējamu pārdēvēšanu / kategorijas norādīšanu), merge (kā alias esošai precei), reject
create or replace function public.resolve_product_proposal(
  p_proposal_id uuid,
  p_action text,
  p_name text default null,
  p_category_id uuid default null,
  p_unit_id uuid default null,
  p_target_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_prop public.product_proposals;
begin
  if not public.is_admin() then
    raise exception 'VT_FORBIDDEN';
  end if;
  select * into v_prop from public.product_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'VT_NOT_FOUND';
  end if;
  if v_prop.status <> 'pending' then
    raise exception 'VT_ALREADY_RESOLVED';
  end if;

  if p_action = 'approve' then
    begin
      update public.products set
        name = coalesce(nullif(btrim(p_name), ''), name),
        category_id = coalesce(p_category_id, category_id),
        base_unit_id = coalesce(p_unit_id, base_unit_id),
        order_unit_id = coalesce(p_unit_id, order_unit_id),
        approval_status = 'approved',
        is_active = true
      where id = v_prop.product_id;
    exception when unique_violation then
      raise exception 'VT_DUPLICATE_NAME';
    end;
    update public.product_proposals
      set status = 'approved', resolved_by = auth.uid(), resolved_at = now(), resolution_note = nullif(btrim(p_note), '')
      where id = p_proposal_id;
  elsif p_action = 'merge' then
    perform public.merge_products(v_prop.product_id, p_target_id);
    update public.product_proposals set resolution_note = nullif(btrim(p_note), '') where id = p_proposal_id;
  elsif p_action = 'reject' then
    update public.products set approval_status = 'rejected', is_active = false where id = v_prop.product_id;
    update public.product_proposals
      set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = nullif(btrim(p_note), '')
      where id = p_proposal_id;
  else
    raise exception 'VT_INVALID';
  end if;
  return jsonb_build_object('status', p_action);
end;
$$;

-- ---------- Kataloga imports ----------------------------------------------------------------------------------------------------------------

-- Iespējamie dublikāti importa priekšskatījumam (neko neapvieno; tikai parāda konfliktus)
create or replace function public.find_similar_products(p_names text[])
returns table (input_index integer, product_id uuid, product_name text, kind text, similarity real)
language plpgsql
stable
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'VT_FORBIDDEN';
  end if;
  perform set_config('pg_trgm.similarity_threshold', '0.6', true);
  return query
  select n.idx::integer, m.id, m.name, m.kind, m.sim
  from unnest(p_names) with ordinality as n(name, idx)
  cross join lateral (
    select * from (
      select p.id, p.name,
             case when p.name_normalized = public.normalize_text(n.name) then 'exact' else 'similar' end as kind,
             similarity(p.name_normalized, public.normalize_text(n.name)) as sim
      from public.products p
      where p.merged_into is null and p.approval_status <> 'rejected'
        and (p.name_normalized = public.normalize_text(n.name) or p.name_normalized % public.normalize_text(n.name))
      union all
      select p.id, p.name, 'alias', 1.0::real
      from public.product_aliases a join public.products p on p.id = a.product_id
      where a.alias_normalized = public.normalize_text(n.name)
    ) s
    order by (s.kind = 'exact') desc, s.sim desc
    limit 3
  ) m;
end;
$$;

-- Importē apstiprinātus produktus (tikai administrators). Esošie nosaukumi tiek izlaisti, nevis pārrakstīti.
create or replace function public.import_products(p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_total integer;
  v_inserted integer;
begin
  if not public.is_admin() then
    raise exception 'VT_FORBIDDEN';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'VT_INVALID';
  end if;
  v_total := jsonb_array_length(p_rows);
  with ins as (
    insert into public.products (name, base_unit_id, order_unit_id, category_id, package_description, notes, barcode,
                                 approval_status, is_active)
    select r.name, r.unit_id, r.unit_id, r.category_id, nullif(btrim(r.package_description), ''),
           nullif(btrim(r.notes), ''), nullif(btrim(r.barcode), ''), 'approved', true
    from jsonb_to_recordset(p_rows) as r(name text, unit_id uuid, category_id uuid, package_description text,
                                         notes text, barcode text)
    where btrim(coalesce(r.name, '')) <> '' and r.unit_id is not null
      and not exists (select 1 from public.product_aliases a where a.alias_normalized = public.normalize_text(r.name))
    on conflict (name_normalized) where (merged_into is null and approval_status <> 'rejected') do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_total - v_inserted);
end;
$$;

-- ---------- Profils ---------------------------------------------------------------------------------------------------------------------------

create or replace function public.update_own_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null or public.current_app_role() is null then
    raise exception 'VT_FORBIDDEN';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'VT_INVALID';
  end if;
  update public.profiles set full_name = v_name where id = auth.uid();
end;
$$;

-- >>>>>>>>>> migrācija: 20260901000600_reference_data_and_grants.sql
-- =============================================================================
-- 06: obligātie atsauces dati (mērvienības, kategorijas, iestatījumi) un funkciju tiesības
-- Šie dati ir nepieciešami, lai lietotne darbotos; parauga produkti un pieteikumi ir supabase/seed.sql.
-- =============================================================================

insert into public.units (code, name, is_countable, warn_quantity, sort_order) values
  ('kg',        'Kilograms',   false,   50,    10),
  ('g',         'Grams',       false,   20000, 20),
  ('L',         'Litrs',       false,   50,    30),
  ('ml',        'Mililitrs',   false,   20000, 40),
  ('gab.',      'Gabals',      true,    200,   50),
  ('iep.',      'Iepakojums',  true,    100,   60),
  ('rullis',    'Rullis',      true,    50,    70),
  ('komplekts', 'Komplekts',   true,    50,    80)
on conflict do nothing;

insert into public.product_categories (name, sort_order) values
  ('Augļi un dārzeņi',                 10),
  ('Gaļa un putnu gaļa',               20),
  ('Zivis un jūras produkti',          30),
  ('Piena produkti',                   40),
  ('Maize un konditorejas izstrādājumi', 50),
  ('Olas',                             60),
  ('Konservi',                         70),
  ('Eļļas un mērces',                  80),
  ('Sausās preces',                    90),
  ('Milti un cepšanas produkti',       100),
  ('Garšvielas',                       110),
  ('Rieksti un sēklas',                120),
  ('Saldētie produkti',                130),
  ('Iepakojums',                       140),
  ('Vienreizlietojamie materiāli',     150),
  ('Marķēšanas materiāli',             160),
  ('Citi',                             999)
on conflict do nothing;

insert into public.app_settings (key, value, description) values
  ('institution_name', '"Valmieras tehnikums"'::jsonb, 'Iestādes nosaukums (drukas skatam un Excel eksportam)'),
  ('autosave_seconds', '3'::jsonb, 'Melnraksta automātiskās saglabāšanas aizkave sekundēs (0 = izslēgta)'),
  ('print_footer',     '""'::jsonb, 'Papildu teksts drukas skata apakšā')
on conflict (key) do nothing;

-- ---------- Funkciju izpildes tiesības -------------------------------------------------------------------
-- Pēc noklusējuma PostgreSQL piešķir EXECUTE visiem; atceļam un piešķiram tikai vajadzīgajām lomām.

revoke execute on all functions in schema public from public, anon, authenticated;

-- Palīgfunkcijas, ko izmanto RLS politikas (tiek izpildītas ar lietotāja tiesībām)
grant execute on function
  public.current_app_role(), public.is_admin(), public.is_sysadmin(),
  public.can_view_owner(uuid), public.can_view_request(uuid), public.can_edit_request(uuid),
  public.normalize_text(text), public.escape_like(text)
  to authenticated;

-- Lietotnes RPC
grant execute on function
  public.search_products(text, integer),
  public.list_products(text, uuid, text, text, integer, integer),
  public.save_request(uuid, jsonb, jsonb),
  public.submit_request(uuid),
  public.copy_request(uuid),
  public.order_lines(uuid, date, date, uuid, uuid, uuid, uuid, uuid, public.request_status[], text),
  public.get_order_summary(uuid, date, date, uuid, uuid, uuid, uuid, uuid, public.request_status[], text),
  public.get_order_report(text, uuid, date, date, uuid, uuid, uuid, uuid, uuid, public.request_status[], text),
  public.dashboard_stats(uuid),
  public.propose_product(text, uuid, uuid, text),
  public.merge_products(uuid, uuid),
  public.resolve_product_proposal(uuid, text, text, uuid, uuid, uuid, text),
  public.find_similar_products(text[]),
  public.import_products(jsonb),
  public.update_own_profile(text)
  to authenticated;

grant execute on all functions in schema public to service_role;

-- >>>>>>>>>> sākuma dati: seed.sql
-- =============================================================================
-- Sākotnējais seed: kursi, parauga grupas, parauga produktu katalogs un sinonīmi.
-- Skriptu drīkst palaist atkārtoti (idempotents). Katalogs ir neierobežoti papildināms —
-- šis ir tikai sākumpunkts. Parauga grupas nomainiet uz reālajām (Grupas lapā).
-- Demo lietotāji un pieteikumi netiek veidoti šeit — skat. scripts/seed-demo.mjs.
-- =============================================================================

insert into public.courses (name, sort_order) values
  ('1. kurss', 10), ('2. kurss', 20), ('3. kurss', 30), ('4. kurss', 40)
on conflict do nothing;

insert into public.groups (name) values
  ('1. grupa'), ('2. grupa'), ('3. grupa'), ('4. grupa'), ('5. grupa'), ('6. grupa')
on conflict do nothing;

-- Produkti: nosaukums | kategorija | pasūtīšanas mērvienība | pamatmērvienība | iepakojums | daudzums iepakojumā
with seed(name, category, order_unit, base_unit, package_description, package_quantity) as (
  values
    -- Augļi un dārzeņi
    ('Bietes',                       'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Bietes tvaicētas',             'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Brokolini',                    'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Brokoļi',                      'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Burkāni',                      'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Citroni',                      'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Dilles svaigas',               'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Kabači',                       'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Kartupeļi',                    'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Ķiploki',                      'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Ķirbis',                       'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Laimi',                        'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Lociņi',                       'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Mango nogatavināti',           'Augļi un dārzeņi', 'gab.', 'gab.', null,        null),
    ('Paprika sarkanā svaiga',       'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Pastinaks',                    'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Pētersīļi lapu',               'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Piparmētras svaigas',          'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Saldais kartupelis',           'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Selerijas sakne',              'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Sīpoli',                       'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Sīpoli sarkanie',              'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Sīpoli šalotes',               'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Spināti svaigi',               'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Šampinjoni svaigi',            'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Tomāti svaigi',                'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Apelsīni sulai',               'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    ('Avokado nogatavināti',         'Augļi un dārzeņi', 'gab.', 'gab.', null,        null),
    ('Avenes svaigas',               'Augļi un dārzeņi', 'kg',   'kg',   null,        null),
    -- Gaļa un putnu gaļa
    ('Cūkgaļa maltā',                'Gaļa un putnu gaļa', 'kg', 'kg',   null,        null),
    ('Tītara fileja',                'Gaļa un putnu gaļa', 'kg', 'kg',   null,        null),
    ('Vistas fileja',                'Gaļa un putnu gaļa', 'kg', 'kg',   null,        null),
    -- Zivis un konservi
    ('Šprotes eļļā',                 'Konservi',         'kg',   'kg',   null,        null),
    -- Piena produkti un olas
    ('Olas',                         'Olas',             'gab.', 'gab.', null,        null),
    ('Piens 2,5% 1×1 L',             'Piena produkti',   'gab.', 'L',    '1×1 L',     1),
    ('Krējums saldais 35%',          'Piena produkti',   'kg',   'kg',   null,        null),
    ('Krējums skābais 25%',          'Piena produkti',   'kg',   'kg',   null,        null),
    ('Siers Čedaras',                'Piena produkti',   'kg',   'kg',   null,        null),
    ('Siers Holandes',               'Piena produkti',   'kg',   'kg',   null,        null),
    ('Siers Mozzarella',             'Piena produkti',   'kg',   'kg',   null,        null),
    ('Sviests 1×0,2 kg',             'Piena produkti',   'gab.', 'kg',   '1×0,2 kg',  0.2),
    ('Sviests 1×0,5 kg',             'Piena produkti',   'gab.', 'kg',   '1×0,5 kg',  0.5),
    -- Maize un konditorejas izstrādājumi
    ('Rudzu maize nesagriezta',      'Maize un konditorejas izstrādājumi', 'gab.', 'gab.', null, null),
    ('Baltmaize',                    'Maize un konditorejas izstrādājumi', 'gab.', 'gab.', null, null),
    -- Sausās preces, milti un cepšana
    ('Cukurs',                       'Sausās preces',    'kg',   'kg',   null,        null),
    ('Sāls',                         'Sausās preces',    'kg',   'kg',   null,        null),
    ('Kviešu milti 405. tips',       'Milti un cepšanas produkti', 'kg', 'kg', null,  null),
    ('Pūdercukurs',                  'Milti un cepšanas produkti', 'kg', 'kg', null,  null),
    ('Raugs sausais',                'Milti un cepšanas produkti', 'g',  'g',  null,  null),
    ('Vanilīna/Vanilas cukurs',      'Milti un cepšanas produkti', 'g',  'g',  null,  null),
    ('Kārtainā mīkla',               'Milti un cepšanas produkti', 'kg', 'kg', null,  null),
    -- Iepakojums, vienreizlietojamie un marķēšanas materiāli
    ('Baltais cepamais papīrs',      'Iepakojums',       'rullis', 'rullis', null,    null),
    ('Konteineri ar vāciņu',         'Iepakojums',       'gab.', 'gab.', null,        null),
    ('Maisiņi ar rokturi',           'Iepakojums',       'gab.', 'gab.', null,        null),
    ('Papīra maisiņi maizei',        'Iepakojums',       'gab.', 'gab.', null,        null),
    ('Sakura komplekts',             'Vienreizlietojamie materiāli', 'gab.', 'gab.', null, null),
    ('Uzlīmju lapiņas marķēšanai',   'Marķēšanas materiāli', 'iep.', 'iep.', null,    null)
)
insert into public.products (name, category_id, order_unit_id, base_unit_id, package_description, package_quantity,
                             approval_status, is_active)
select s.name, c.id, ou.id, bu.id, s.package_description, s.package_quantity, 'approved', true
from seed s
join public.product_categories c on c.name = s.category
join public.units ou on ou.code = s.order_unit
join public.units bu on bu.code = s.base_unit
on conflict (name_normalized) where (merged_into is null and approval_status <> 'rejected') do nothing;

-- Sinonīmi (alias): dažādi pareizrakstības varianti un saīsinājumi -> apstiprināta kataloga prece.
-- Tie NETIEK automātiski apvienoti; tikai palīdz atrast pareizo preci.
with alias_seed(alias, product_name) as (
  values
    ('Mozarella',        'Siers Mozzarella'),
    ('Mocarella',        'Siers Mozzarella'),
    ('Mozzarella',       'Siers Mozzarella'),
    ('Dilles',           'Dilles svaigas'),
    ('Saldais krējums',  'Krējums saldais 35%'),
    ('Skābais krējums 25%', 'Krējums skābais 25%'),
    ('Tomāti',           'Tomāti svaigi'),
    ('Spināti',          'Spināti svaigi'),
    ('Šampinjoni',       'Šampinjoni svaigi'),
    ('Kartupeļi saldie', 'Saldais kartupelis'),
    ('Cepamais papīrs',  'Baltais cepamais papīrs'),
    ('Etiķetes',         'Uzlīmju lapiņas marķēšanai')
)
insert into public.product_aliases (product_id, alias)
select p.id, a.alias
from alias_seed a
join public.products p on p.name_normalized = public.normalize_text(a.product_name) and p.merged_into is null
on conflict (alias_normalized) do nothing;
