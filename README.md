# Valmieras tehnikums — pārtikas produktu un materiālu pieteikumu sistēma

Droša tīmekļa lietotne, kurā **pedagogi** iesniedz pieteikumus praktiskajām nodarbībām (preces un daudzumi), bet
**pasūtītājs / administrators** automātiski iegūst vienu apkopotu pasūtījumu — ar iespēju jebkurai kopsummai
atvērt sākotnējos pieteikumus, no kuriem tā izveidojusies, un eksportēt rezultātu Excel failā.

> Piemērs: Bietes tvaicētas — pedagogs A 0,5 kg + pedagogs B 2 kg + pedagogs C 1,5 kg → kopējā pasūtījumā **4,0 kg**;
> administrators var atvērt šo 4,0 kg un redzēt visus trīs avotus.

---

## Saturs

1. [Ko sistēma dara](#1-ko-sistēma-dara)
2. [Tehnoloģijas un arhitektūra](#2-tehnoloģijas-un-arhitektūra)
3. [Datubāzes tabulas](#3-datubāzes-tabulas)
4. [Lomas un tiesības](#4-lomas-un-tiesības)
5. [Lokālā palaišana](#5-lokālā-palaišana)
6. [Supabase izveide un konfigurēšana](#6-supabase-izveide-un-konfigurēšana)
7. [Migrācijas un seed](#7-migrācijas-un-seed)
8. [Pirmā administratora izveide un lietotāji](#8-pirmā-administratora-izveide-un-lietotāji)
9. [Vides mainīgie](#9-vides-mainīgie)
10. [Publicēšana Vercel](#10-publicēšana-vercel)
11. [Datubāzes backup rekomendācijas](#11-datubāzes-backup-rekomendācijas)
12. [Testēšana](#12-testēšana)
13. [Drošība](#13-drošība)
14. [Pieņēmumi un ierobežojumi](#14-pieņēmumi-un-ierobežojumi)
15. [Projekta struktūra](#15-projekta-struktūra)
16. [Problēmu risināšana](#16-problēmu-risināšana)

---

## 1. Ko sistēma dara

**Pedagogs**
- piesakās ar e-pastu un paroli; vārds tiek automātiski ielasīts no profila;
- aizpilda pieteikumu, kas vizuāli atgādina VT ikdienas veidlapu (kurss/grupa/audzēknis, pasniedzējs, tēma, datums,
  audzēkņu skaits, preču saraksts ar Npk., prece, mērv., daudzums, piezīmes);
- preci izvēlas ar **ātru meklēšanu (typeahead)** — pēc nosaukuma fragmenta, bez reģistrjutības un diakritikām
  (`kiploki` → *Ķiploki*), pēc sinonīmiem (`mocarella` → *Siers Mozzarella*); mērvienība aizpildās pati;
- ievade tastatūrai: Enter pāriet uz nākamo lauku, dublēšana/dzēšana, brīdinājumi (nederīgs skaitlis, neparasti liels
  daudzums, prece divreiz ar piedāvājumu **«Apvienot rindas?»**);
- **melnraksts un autosave**; iesniegšana; labošana līdz termiņam; **kopēšana** (jauns melnraksts, oriģināls netiek mainīts);
- **ierosina jaunu preci**, ja tās nav katalogā (izmantojama uzreiz, administrators apstiprina);
- A4 **drukas skats**.

**Pasūtītājs / administrators**
- redz visus pieteikumus, filtrē (periods, datums, pedagogs, grupa, kurss, prece, kategorija, statuss, tēma), maina statusus;
- **Kopējais pasūtījums**: summēšana pēc `product_id` + mērvienības, ar «Detalizēti» (kas, kad, cik) un **Excel eksportu**
  (6 lapas: kopējais pasūtījums, detalizēti, pa pedagogiem, grupām, datumiem, kategorijām);
- pārvalda preču katalogu (labošana, sinonīmi, apvienošana, imports no Excel/CSV ar priekšskatījumu un konfliktiem);
- izskata jaunās preces (apstiprināt / pārdēvēt / kategorija / pievienot kā sinonīmu / noraidīt);
- izveido periodus ar iesniegšanas termiņu; darbplūsma *Atvērts → Apkopošanā → Pasūtīts*;
- dashboard ar KPI, pārskati, audita vēsture.

**Sistēmas administrators** papildus: lietotāji un lomas, grupas/kursi, mērvienības, iestatījumi, papildu piekļuves tiesības.

## 2. Tehnoloģijas un arhitektūra

| Slānis | Tehnoloģija |
|---|---|
| Lietotne | **Next.js 16** (App Router, Server Components + Server Actions), React 19, TypeScript (strict) |
| Datubāze, autentifikācija | **Supabase**: PostgreSQL, Supabase Auth, Row Level Security |
| Izvietošana | **Vercel** + GitHub |
| Excel | ExcelJS |
| Fonts | DM Sans (`@fontsource-variable/dm-sans`, hostēts kopā ar lietotni; rezerve — Arial) |
| Testi | Vitest (vienības + datubāze), Playwright (e2e), axe-core (pieejamība) |

```
Pārlūks ──HTTPS──▶ Next.js (Vercel)  ──(lietotāja JWT sīkdatnē)──▶ Supabase
                    │  proxy.ts: sesija, CSP           ├─ Auth (GoTrue)
                    │  Server Components / Actions     └─ PostgreSQL + RLS + SQL funkcijas
                    └─ /api: meklēšana, eksports
```

Galvenie arhitektūras lēmumi:

- **Visa biznesa loģika, kas nedrīkst tikt apieta, ir datubāzē** (`supabase/migrations`): RLS politikas, pieteikuma
  iesniegšanas validācija, termiņu kontrole, statusu pārejas, audita trigeri. Pārlūks nekad nesazinās ar Supabase tieši —
  visi pieprasījumi iet caur Next.js serveri ar lietotāja sesiju, tāpēc RLS ir spēkā katram vaicājumam.
- **Kopējais pasūtījums netiek glabāts kā teksts** — to aprēķina SQL funkcijas `order_lines`, `get_order_summary`,
  `get_order_report` no `request_items` (`numeric`, bez peldošā komata kļūdām). Detalizācija, pārskati un Excel izmanto
  **to pašu** `order_lines`, tāpēc kopsumma vienmēr sakrīt ar sākotnējām rindām.
- **Summēšana pēc `product_id` un mērvienības**, nevis pēc nosaukuma: «Bietes» ≠ «Bietes tvaicētas», «Sviests 1×0,2 kg» ≠
  «Sviests 1×0,5 kg»; kg un g netiek maisīti kopā. Iepakojuma koeficients (piem., 3 gab. × 0,2 kg) tiek rādīts tikai kā
  papildu informācija.
- **Meklēšana serverī** (`search_products`): normalizēts nosaukums (mazie burti, latviešu diakritika, `×`→`x`, `0,5`≡`0.5`),
  trigrammu GIN indeksi, ranžēšana (precīza sakritība → sākas ar → vārda sākums → satur → sinonīms → drukas kļūdas).
  Pārlūkā netiek ielādēts viss katalogs; 10 000 produktu katalogā atbilde ir ~50–150 ms.
- **Autosave** izmanto vienu atomāru RPC `save_request` (rindu kopa tiek sinhronizēta vienā transakcijā) ar **optimistisko bloķēšanu**
  (`expected_updated_at`): ja pieteikums starplaikā mainīts citā logā vai ar citu lietotāju, saglabāšana tiek noraidīta ar saprotamu paziņojumu,
  nevis klusi pārrakstīta. Iesniegta pieteikuma obligātie lauki (tēma, datums, periods, vismaz viena rinda ar daudzumu > 0) tiek pārbaudīti
  **arī pēc katras turpmākās labošanas** (datubāzes trigeri; nav apejami ar tiešu API pieprasījumu).
- **Decimālskaitļi**: datubāzē `numeric(14,3)`; JavaScript pusē tekstu/BigInt aritmētika (`src/lib/decimal.ts`) — pieņem `0,5` un
  `0.5`, attēlo latviski (`0,5 kg`, `4,0`).

## 3. Datubāzes tabulas

`profiles`, `user_roles` (lomu piešķiršana), `teacher_access_grants` (papildu piekļuve citu pedagogu pieteikumiem),
`courses`, `groups`, `units`, `product_categories`, `products`, `product_aliases`, `product_proposals`,
`order_periods`, `requests`, `request_items`, `audit_log`, `app_settings`.

- `products`: id, nosaukums, `name_normalized`, kategorija, pamatmērvienība, pasūtīšanas mērvienība, iepakojuma apraksts,
  daudzums iepakojumā, svītrkods, piezīmes, aktīvs, apstiprinājuma statuss (`pending/approved/rejected`), izveidoja/apstiprināja
  (+ laiki), `merged_into`.
- `request_items`: `request_id`, `product_id`, `quantity numeric(14,3)`, `unit_id`, `notes`, `position`.
- `audit_log` ir *append-only*: trigeri aizliedz UPDATE/DELETE/TRUNCATE, parastiem lietotājiem nav rakstīšanas tiesību,
  lasīt var tikai administratori.
- Indeksi: trigrammu GIN uz `products.name_normalized` un `product_aliases.alias_normalized`, prefiksu B-tree, indeksi uz
  `requests(period_id,status)`, `requests(teacher_id,…)`, `request_items(request_id,position)`, `request_items(product_id,unit_id)`,
  `audit_log(created_at)` u.c.

## 4. Lomas un tiesības

| Darbība | Pedagogs | Pasūtītājs | Sist. administrators |
|---|:-:|:-:|:-:|
| Savi pieteikumi (izveidot, labot līdz termiņam, kopēt, dzēst melnrakstu) | ✔ | ✔ | ✔ |
| Citu pieteikumi | — (tikai ar piešķirtu piekļuvi) | ✔ visi | ✔ visi |
| Preču katalogs (skatīt, meklēt, ierosināt) | ✔ | ✔ | ✔ |
| Katalogs: labot, sinonīmi, apvienot, imports, kategorijas | — | ✔ | ✔ |
| Jaunās preces: apstiprināt / noraidīt | — | ✔ | ✔ |
| Kopējais pasūtījums, Excel, pārskati, periodi, statusi, audits | — | ✔ | ✔ |
| Grupas/kursi (labot), mērvienības, iestatījumi, lietotāji, lomas | — | — (grupas: tikai skatīt) | ✔ |

Tiesības tiek pārbaudītas **trīs reizes**: (1) `proxy.ts` (sesija), (2) katras lapas/Server Action/API servera kods
(`requireAdmin`, `actionAdmin` …), (3) **Row Level Security datubāzē** — pat tieša piekļuve PostgREST ar lietotāja JWT nedod
vairāk, nekā atļauj RLS. Deaktivizēts lietotājs zaudē visu piekļuvi (arī RLS līmenī).

## 5. Lokālā palaišana

Nepieciešams: **Node.js ≥ 20.9** (ieteicams 22), npm, Supabase projekts (mākonī vai lokāli).

```bash
git clone https://github.com/LidaRi25/Pasut-jui_Valmierastehnikums.git
cd Pasut-jui_Valmierastehnikums
npm install
cp .env.example .env.local     # ierakstiet savas Supabase vērtības (skat. 6. un 9. sadaļu)
# izveidojiet datubāzi un pirmo administratoru (7. un 8. sadaļa), tad:
npm run dev                     # http://localhost:3000
```

Kvalitātes pārbaudes: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

**Lokāls Supabase ar Docker (neobligāti):** `npx supabase start` izmanto `supabase/config.toml`, automātiski piemēro
`supabase/migrations` un `supabase/seed.sql`. Izdrukātās `API URL`, `anon key`, `service_role key` ierakstiet `.env.local`.
*(Šī ceļa Docker vidē šeit nevarēja izmēģināt — skat. 14. sadaļu.)*

## 6. Supabase izveide un konfigurēšana

1. Reģistrējieties [supabase.com](https://supabase.com) → **New project**. Izvēlieties reģionu tuvu lietotājiem
   (piem., *Frankfurt* / *Stockholm*) un **saglabājiet datubāzes paroli**.
2. **Project Settings → API**: nokopējiet
   - *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`
   - *anon / publishable key* → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - *service_role / secret key* → `SUPABASE_SERVICE_ROLE_KEY` (**slepena!**)
3. **Authentication → Sign In / Providers → Email**:
   - **izslēdziet** *Allow new users to sign up* (sistēma nav publiski lietojama; konti tiek izveidoti tikai administratora sadaļā);
   - *Minimum password length* = 8 vai vairāk (ieteicams 10+); pēc iespējas ieslēdziet *Prevent use of leaked passwords* (Pro plāns);
   - *Confirm email* var atstāt ieslēgtu — konti, ko izveido administrators, tiek atzīmēti kā apstiprināti.
4. **Authentication → URL Configuration**: *Site URL* = jūsu publiskā adrese (piem., `https://pieteikumi.valmierastehnikums.lv`).
5. (Neobligāti) **Authentication → SMTP**: pašu SMTP serveris, ja vēlēsieties e-pasta paziņojumus nākotnē.

## 7. Migrācijas un seed

Datubāzes shēma ir `supabase/migrations/*.sql` (secīgi, 6 faili), sākuma dati — `supabase/seed.sql`
(kursi, parauga grupas, ~57 preces ar sinonīmiem). Seed ir idempotents.

**Variants A — Supabase CLI** (ieteicams izstrādātājiem):

```bash
npx supabase login
npx supabase link --project-ref <projekta-ref>     # Project Settings → General → Reference ID
npx supabase db push                               # piemēro migrācijas
# seed: izpildiet supabase/seed.sql SQL Editor'ā (db push to neizpilda), vai:
npx supabase db push --include-seed
```

**Variants B — bez CLI** (vienkāršākais): Supabase → **SQL Editor → New query**, ielīmējiet visu
[`supabase/setup-all.sql`](supabase/setup-all.sql) (migrācijas + seed vienā failā) un nospiediet **Run**. Izpildiet
**vienreiz** jaunā, tukšā projektā. Ja mainījāt migrācijas, atjauniniet failu: `node scripts/bundle-sql.mjs`.

Seed satur arī paraugu grupas («1. grupa» … «6. grupa») un kursus — nomainiet tos uz reālajiem sadaļā **Grupas**.

## 8. Pirmā administratora izveide un lietotāji

**Pirmais sistēmas administrators** (vienreiz, no sava datora):

```bash
npm run create-admin -- --email vards.uzvards@valmierastehnikums.lv --name "Vārds Uzvārds"
# (ģenerē pagaidu paroli un izdrukā to; var norādīt arī --password "...")
```

Skripts izmanto `.env.local` (`SUPABASE_SERVICE_ROLE_KEY`). Alternatīva bez skripta: Supabase → *Authentication → Users → Add user*
(ar «Auto confirm»), tad SQL Editor'ā:

```sql
update public.user_roles set role = 'sysadmin'
where user_id = (select id from auth.users where email = 'vards.uzvards@valmierastehnikums.lv');
```

**Turpmākie lietotāji:** pieteikties → **Lietotāji → Jauns lietotājs** (e-pasts, vārds, loma, parole vai automātiski ģenerēta).
Tur pat var mainīt lomas, atiestatīt paroli, deaktivizēt kontu un piešķirt papildu piekļuvi pieteikumiem. Katrs lietotājs
paroli var nomainīt sadaļā **Profils**. Lietotājus nedzēš, bet deaktivizē (lai saglabātu pieteikumu vēsturi).

**Demo dati** (tikai izstrādei/apmācībai, **nekad produkcijā ar īstiem lietotājiem**): 3 pedagogi, pasūtītājs, sistēmas
administrators, periodi un vairāki pieteikumi, t.sk. specifikācijas paraugs (Sanita Reinfelde, *Baltic VET Skills 2026*):

```bash
npm run seed:demo -- --password "Demo-Parole-2026"     # e-pasti: sanita.reinfelde@vt.test, pasutitajs@vt.test u.c.
```

## 9. Vides mainīgie

| Mainīgais | Nozīme | Publisks? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase projekta URL | jā |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable atslēga (drošību nodrošina RLS) | jā |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret atslēga — tikai serverī (lietotāju izveide, paroles atiestatīšana) | **NĒ** |
| `NEXT_PUBLIC_SITE_URL` | lietotnes adrese; ja sākas ar `http://`, sesijas sīkdatnēm netiek likts `Secure` (tikai lokāli) | jā |

Slepenas atslēgas netiek glabātas pirmkodā; `.env*` faili ir `.gitignore`. Piemērs: [`.env.example`](.env.example).

## 10. Publicēšana Vercel

1. Pārliecinieties, ka kods ir GitHub repozitorijā (`main` vai izvēlētajā zarā).
2. [vercel.com](https://vercel.com) → **Add New… → Project** → importējiet GitHub repozitoriju. Framework — *Next.js* (nosaka automātiski;
   [`vercel.json`](vercel.json) iestata funkciju reģionu `fra1` — tuvu Supabase EU reģionam; ja Supabase ir citur, nomainiet).
3. **Environment Variables** (Production **un** Preview): pievienojiet `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (= galīgā https adrese).
4. **Deploy**. Katrs `git push` uz ražošanas zaru automātiski izvieto jaunu versiju.
5. **Settings → Domains**: pievienojiet savu domēnu (piem., `pieteikumi.valmierastehnikums.lv`) un norādiet DNS ierakstu, ko parāda Vercel.
   Tad Supabase *Authentication → URL Configuration → Site URL* iestatiet uz šo domēnu.
6. Atveriet adresi, piesakieties kā sistēmas administrators, izveidojiet periodu un lietotājus (skat. zemāk «Pirms reālas lietošanas»).

**Kādu adresi lietotāji lietos:** Vercel piešķirto `https://<projekta-nosaukums>.vercel.app` vai jūsu pašu domēnu
(ieteicams, piem., `https://pieteikumi.valmierastehnikums.lv`). Pieteikšanās lapa: `/login`; pārējā sistēma bez pieteikšanās nav pieejama.

**Pirms reālas lietošanas administratoram jāiestata:**
- [ ] izveidots pirmais sistēmas administrators, nomainīta pagaidu parole;
- [ ] Supabase: publiskā reģistrācija izslēgta, paroles minimālais garums ≥ 8;
- [ ] sadaļā **Grupas** — reālās grupas un kursi (parauga grupas ir tikai piemērs);
- [ ] sadaļā **Preču katalogs → Imports** — ielādēts reālais katalogs (vai papildināts seed katalogs); pārbaudītas kategorijas un mērvienības;
- [ ] sadaļā **Iestatījumi** — iestādes nosaukums, autosave intervāls; **Mērvienības** — brīdinājuma sliekšņi «neparasti liels daudzums»;
- [ ] sadaļā **Periodi** — izveidots pirmais periods ar iesniegšanas termiņu;
- [ ] sadaļā **Lietotāji** — izveidoti pedagogi un pasūtītāji;
- [ ] pārbaudīts backup plāns (11. sadaļa); pārbaudīts, ka `SUPABASE_SERVICE_ROLE_KEY` nav publiski redzams;
- [ ] (pēc vajadzības) VT oficiālais logotips: šajā repozitorijā tā nav — tiek izmantots tekstuāls vārdzīmols un neitrāla ikona (`src/app/icon.svg`).

## 11. Datubāzes backup rekomendācijas

- **Supabase Pro plāns**: automātiski ikdienas backup (7 dienas) un — ieteicams — *Point-in-Time Recovery* (Project Settings → Add-ons).
  **Bezmaksas plānā backup nav** — tad obligāti veiciet regulāru eksportu:
  ```bash
  # Project Settings → Database → Connection string (Session pooler / Direct)
  pg_dump "postgresql://postgres:<parole>@db.<ref>.supabase.co:5432/postgres" \
    --schema=public --no-owner --format=custom -f vt-backup-$(date +%F).dump
  ```
  Plānojiet to nedēļā vismaz reizi (vai GitHub Actions/cron) un glabājiet kopijas ārpus Supabase (šifrētā mapē/mākonī).
  Lietotāju konti atrodas `auth` shēmā — pilnam backup izmantojiet `supabase db dump` vai Supabase backup.
- **Atjaunošanu pārbaudiet** vismaz reizi semestrī: `pg_restore` uz testa projektu.
- Papildu drošības tīkls: pēc katra perioda saglabājiet **Excel eksportu** (tas ir lasāms cilvēkam un neatkarīgs no DB).
- Audita vēsturi (`audit_log`) nevar labot vai dzēst no lietotnes; tā tiek iekļauta `pg_dump`.
- Migrāciju maiņa ražošanā: vispirms izmēģiniet testa Supabase projektā; nekad nelabojiet jau piemērotas migrācijas — pievienojiet jaunu failu.

## 12. Testēšana

```bash
npm test                 # 50 vienībtesti + 46 datubāzes testi (DB testi tiek izlaisti bez TEST_DATABASE_URL)
npm run lint && npm run typecheck && npm run build
```

**Datubāzes testi** (`tests/db`, 46 testi) darbojas pret īstu PostgreSQL (RLS, trigeri, funkcijas — ar Supabase saderīgu `auth.uid()`):

```bash
bash scripts/local-pg.sh start                      # lokāls PostgreSQL bez Docker (vai izmantojiet savu serveri)
export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54322/postgres
npm run test:db
```

**E2E testi** (`e2e`, Playwright) darbojas pret pašu lietotni un **pilnu Supabase-saderīgu steku** (PostgreSQL + īstais GoTrue
+ PostgREST + neliela vārteja; skat. `e2e/stack/stack.mjs`) — tādējādi tiek pārbaudīta reālā autentifikācija un RLS:

```bash
# vienreiz: GoTrue (supabase/auth) un PostgREST bināri; norādiet ceļus:
export GOTRUE_BIN=… GOTRUE_DIR=…/auth-src POSTGREST_BIN=…
npm run e2e:prepare      # izveido svaigu DB, migrācijas, seed, demo lietotājus
npm run build && npx playwright test          # (PW_CHROMIUM=/ceļš/uz/chromium, ja nav Playwright pārlūka)
```

Testi aptver: (1) summēšana no vairākiem pieteikumiem; (2) dažādi `product_id` netiek apvienoti; (3) `0,5` un `0.5`; (4) pedagogs neredz citu
datus; (5) administrators redz visus; (6) Excel eksports satur pareizās kopsummas; (7) kopēšana nemaina veco pieteikumu; (8) neaktīvu
produktu nevar izvēlēties; (9) alias meklēšana; (10) perioda filtrs — un vēl RLS, audita nemaināmību, termiņu, iesniegšanas
validāciju, apvienošanu, importu, veiktspēju (10 000 produktu, 150 rindu pieteikums), pieejamību (axe-core), mobilo skatu.
Kopā: 96 vienības/DB testi + 40 e2e testi (38 darbvirsmas + 2 mobilie).

## 13. Drošība

Realizēts:
- **RLS** visām tabulām; `anon` lomai nav nekādu tiesību; funkciju `EXECUTE` tiesības atceltas un piešķirtas tikai vajadzīgajām lomām;
  audita ierakstus veido tikai trigeri (`SECURITY DEFINER`), lietotājs tos nevar viltot vai labot.
- **Servera puses autorizācija** katrā lapā, Server Action un API; pieprasījumi bez pieteikšanās → 401/novirzīšana; pieprasījumi bez tiesībām → 403.
  Cita pedagoga pieteikuma ID nomaiņa URL dod «Lapa nav atrasta» (RLS neatgriež ierakstu).
- **SQL injekcija**: visi vaicājumi parametrizēti (Supabase klients / RPC); `LIKE` speciālsimboli tiek izbēgti (`escape_like`); filtru parametri tiek validēti (UUID, datumi, uzskaitījumi).
- **XSS**: React ekrānēšana, nav `dangerouslySetInnerHTML`; **CSP ar nonce** katram pieprasījumam, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS.
- **Sesijas sīkdatnes** `httpOnly`, `sameSite=lax`, `Secure` (HTTPS); Server Actions izmanto Next.js Origin pārbaudi (CSRF); novirzīšanas parametri (`next`, `back`) pieņem tikai iekšējus ceļus.
- **Failu imports**: izmērs ≤ 5 MB, tikai `.xlsx`/`.csv`, formāta (magic bytes) pārbaude, ≤ 20 000 rindu, šūnu satura tīrīšana; formulas netiek izpildītas.
- **Vides mainīgie**: service-role atslēga tiek lietota tikai serverī (`server-only`), pēc skaidras lomas pārbaudes.
- Pēdējo sistēmas administratoru nevar deaktivizēt vai pazemināt (datubāzes trigeris).

Nav realizēts: paša veidots pieteikšanās mēģinājumu ierobežojums (tiek izmantoti Supabase Auth rate limits), divfaktoru autentifikācija.

## 14. Pieņēmumi un ierobežojumi

Interpretācijas, kur specifikācija bija nepilnīga:
- **Statusi kopējā pasūtījumā**: pēc noklusējuma tiek ņemti *Iesniegts, Apstiprināts, Iekļauts pasūtījumā, Pasūtīts* (bez melnrakstiem un atceltajiem); filtrā to var mainīt.
- **Periods ir obligāts iesniegšanai** (bez perioda pieteikums nekur neiekļūtu pasūtījumā). Melnrakstu var saglabāt arī bez perioda. Pēc termiņa pedagogs
  iesniegtu pieteikumu vairs nevar labot vai atcelt; administrators var vienmēr.
- **Tiesības**: kategorijas pārvalda arī pasūtītājs (§11), bet grupas, kursus, mērvienības, iestatījumus un lietotājus — tikai sistēmas administrators (§3).
  Pasūtītājam sadaļa «Grupas» ir tikai skatīšanai.
- **Apvienojot preces** (kļūdaini izveidotu ar pareizo), pieteikumu rindas tiek pārceltas uz pareizo preci un notikums tiek reģistrēts audita vēsturē;
  nekas netiek apvienots automātiski.
- **Neapstiprinātas preces** redz tikai to ierosinātājs un administratori; noraidītas preces rindas paliek pieteikumā un kopsummā tiek atzīmētas.
- **Mērvienības netiek konvertētas** (kg↔g, gab.↔L). Ja pedagogs nomaina mērvienību, tā tiek summēta atsevišķi un pieteikumā parādās brīdinājums.
- **Excel fonts ir Arial** (DM Sans nav pieejams parastā Excel vidē; nesakritības gadījumā Excel to aizstātu ar citu fontu). Web saskarnē tiek lietots DM Sans.
- Skaitļu formāts Excel failā (`#,##0.0##`) tiek attēlots pēc lietotāja Excel reģionālajiem iestatījumiem (latviešu Excel — ar komatu).

Nav realizēts / nav pārbaudīts:
- **«Aizmirsu paroli» pašapkalpošanās** (e-pasta atiestatīšana) — paroli atiestata sistēmas administrators sadaļā «Lietotāji»; pati lietotājs var nomainīt sadaļā «Profils».
- **Lietotāju dzēšana** — tikai deaktivizēšana.
- **E-pasta paziņojumi** (par termiņiem u.c.) nav.
- **Supabase CLI lokālā vide** (`supabase/config.toml`, Docker) šeit netika izmēģināta (nebija Docker); migrācijas ir pārbaudītas uz PostgreSQL 16 ar Supabase saderīgu auth slāni
  un uz reāla GoTrue + PostgREST.
- **Reāls Supabase mākoņa projekts un Vercel izvietojums šajā sesijā netika veidots** (nav piekļuves jūsu kontiem) — sagatavota konfigurācija un instrukcijas; pirmais production build ir pārbaudīts lokāli.
- E2E netiek palaisti GitHub Actions (vajadzīgi GoTrue/PostgREST bināri); CI palaiž lint, typecheck, vienībtestus, DB testus un build.

## 15. Projekta struktūra

```
supabase/
  migrations/           SQL migrācijas: tabulas, trigeri, RLS, RPC funkcijas, atsauces dati, tiesības
  seed.sql              kursi, parauga grupas, parauga produkti un sinonīmi
  setup-all.sql         ĢENERĒTS: viss vienā failā ielīmēšanai SQL Editor'ā (node scripts/bundle-sql.mjs)
  config.toml           Supabase CLI lokālajai videi
src/
  proxy.ts              sesijas atjaunošana, pieteikšanās prasība, CSP (Next.js 16 "proxy")
  app/(app)/…           autentificētās lapas (sākums, pieteikumi, katalogs, pasūtījums, periodi, pārskati, lietotāji, iestatījumi, profils)
  app/(print)/…         A4 drukas skats
  app/api/…             products/search, export/order (Excel), order/lines (detalizācija), health
  components/           UI komponentes (request-editor, product-combobox, summary-table …)
  lib/                  auth, decimal, format, errors (latviski), order-filters, excel/order-workbook, import/parse, supabase klienti
scripts/                create-first-admin, seed-demo, bundle-sql, local-pg.sh
tests/                  unit/ (Vitest), db/ (Vitest + PostgreSQL)
e2e/                    Playwright testi + lokālais Supabase-saderīgais steks
```

## 16. Problēmu risināšana

- **«Sistēma nav konfigurēta» / 503** — trūkst `NEXT_PUBLIC_SUPABASE_URL` vai atslēgas Vercel/`.env.local`.
- **Pieteikšanās neizdodas ar pareizu paroli** — pārbaudiet, vai lietotājs ir aktīvs (Lietotāji) un vai Supabase projekts nav pauzēts (bezmaksas plāns pauzē neaktīvus projektus).
- **Pedagogs neredz periodu** — periodam jābūt statusā «Atvērts» un iesniegšanas termiņam nākotnē.
- **Kopsumma «pazūd»** — pārbaudiet statusu filtru (melnraksti un atceltie netiek skaitīti) un perioda izvēli.
- **Migrācija neizdodas** — izpildiet uz tukša projekta; ja daļēji piemērota, izveidojiet jaunu projektu vai atjaunojiet no backup.
