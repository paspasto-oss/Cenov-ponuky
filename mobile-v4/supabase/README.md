# Online databáza – Supabase

GitHub Pages ostáva frontend. Spoločné dáta budú v Supabase PostgreSQL.

## Prečo
- 14 000+ zásob sa nemajú držať len v localStorage,
- Martina a technici musia vidieť rovnaké zásoby a ponuky,
- ponuky sa musia dať otvárať a upravovať na inom zariadení,
- POHODA synchronizácia má aktualizovať jeden centrálny katalóg.

## Bezpečnosť
Používa sa Supabase Auth + Row Level Security.
Do prehliadača patrí iba verejný `anonKey`. Nikdy nie `service_role`.

## Pripravené súbory
- `supabase/schema.sql` – tabuľky a RLS,
- `js/db.js` – klient pre zásoby, ponuky a položky,
- `supabase-config.example.js` – šablóna konfigurácie.
- `database/004_inspection_photo_storage.sql` – Obhliadky, bucket `inspection-media`, malé náhľady fotiek a polia pre Drive odkazy.
- `database/005_fix_inspection_photo_drive_columns.sql` – rýchla oprava existujúcej Supabase tabuľky, keď chýbajú polia `drive_file_url`/`drive_folder_url`.

## Ďalší krok
Po pripojení Supabase pluginu vytvoríme projekt, aplikujeme schema.sql, vytvoríme účty/roly a doplníme URL + anon key.
Potom jednorazovo prenesieme aktuálnych 14 000+ zásob z POHODY do `pohoda_stocks`.
