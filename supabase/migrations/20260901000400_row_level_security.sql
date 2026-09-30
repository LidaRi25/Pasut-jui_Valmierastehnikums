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
