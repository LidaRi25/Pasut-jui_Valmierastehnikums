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
