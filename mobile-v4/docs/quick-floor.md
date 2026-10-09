# Jednoduchá ponuka podlahového kúrenia

Bežný postup: Nová ponuka -> Rýchla ponuka zo scenára -> Podlahové kúrenie -> plocha a celkové km -> Uložiť ponuku alebo PDF / Odoslanie.

Nová ponuka začína na 1 m² a 0 km. Km znamenajú celkový počet kilometrov vrátane návratu, bez automatického násobenia dvoma. Zobrazené sú tri súhrnné riadky: materiál, montáž a doprava. Podrobný kusovník zostáva v q.items, nie v duplicitne účtovanej súhrnnej položke.

## Jednorazová príprava spoločného štandardu

V samostatnej pripravenej podlahovej ponuke otvorte Rozšírené úpravy. Spárujte materiálové položky s presnými kódmi POHODA a skontrolujte jednotky. Potom zvoľte Nastaviť štandard na 1 m². Potvrďte východiskovú plochu, spôsob násobenia každej položky a sadzbu montáže €/m² aj dopravy €/km. Uložte štandard pri prihlásení.

Štandard sa ukladá do existujúcej spoločnej quote_library pod kľúčom pricing:floor-quick-v1 s optimistickou kontrolou revision. Neobsahuje zákazníka ani údaje ponuky. Nie je potrebná databázová migrácia. Zobrazenie nie je novou používateľskou rolou ani náhradou prístupových oprávnení.

Potrubie a dosky sú normatív na m². Rozdeľovač a skrinka sú predvolene raz na zákazku; v nastavení možno spôsob zmeniť. Technik musí skontrolovať vhodnosť zostavy a počet okruhov pre konkrétny objekt. Ide o cenový štandard, nie hydraulický návrh.

## Ochrana údajov

Otvorenie ponuky ani prepnutie jednoduchého/rozšíreného zobrazenia nič neukladá. Existujúce ceny sa pri zmene plochy zachovajú; nové ponuky používajú aktuálne karty podľa presného kódu. Chýbajúca alebo nejednoznačná karta, iná jednotka či chýbajúca cena zostane nenacenená. Pred PDF musí byť ponuka kompletne ocenená. Uloženie používa existujúci outbox a mechanizmus revízií; opakované otvorenie finálneho náhľadu bez zmien nevytvára revíziu.

Zmiešané ponuky, viac scenárov, doplnky a varianty zostávajú v plnom editore, aby jednoduché zobrazenie neskrylo ďalšie účtované položky. Doplnkový modul sa načítava z rovnakého nasadenia cez home-toolbar.js; pri chybe načítania zostáva pôvodný editor dostupný.

## Overenie

node --test mobile-v4/tests/*.cjs

314 testov prešlo vrátane 16 nových testov jednoduchého editora. V izolovanom Chromium sa preveril postup výber -> m² a km -> uloženie cez reálny outbox s testovacím úložiskom -> finálny náhľad, uloženie štandardu a mobilné zobrazenie 390 px. Produkčné zásoby, cenové ponuky ani spoločné sadzby neboli pri testovaní menené. Ceny v testoch sú výhradne testovacie.
