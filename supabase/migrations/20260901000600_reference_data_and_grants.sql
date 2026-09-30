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
