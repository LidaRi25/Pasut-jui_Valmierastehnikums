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
