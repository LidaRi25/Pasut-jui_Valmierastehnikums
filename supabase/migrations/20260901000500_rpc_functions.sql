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
-- p_data:  { period_id, course_id, group_id, students, topic, lesson_date, student_count, notes }
-- p_items: [ { id?, product_id, unit_id, quantity (teksts vai null), notes } ]  — masīva secība = Npk.
-- Rindas bez product_id netiek saglabātas (tās paliek tikai lietotāja formā).

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
