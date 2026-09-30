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
