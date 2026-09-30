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
  check (merged_into is null or merged_into <> id),
  -- Apvienota (kļūdaini izveidota) prece nedrīkst kļūt atkal aktīva — vēsture paliek neskarta
  check (merged_into is null or not is_active)
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
