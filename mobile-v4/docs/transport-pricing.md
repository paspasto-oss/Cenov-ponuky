# Doprava – pravidlá a nasadenie (#21)

Východisko je Hollého 210, 015 01 Rajec. Prednosť má `customer.realization_address`, inak `customer.address` (existujúce pole adresy realizácie).

- Rajec: 10 € bez DPH za výjazd podľa overenej obce, nie podľa podreťazca adresy.
- Inde: `výjazdy × max(25, spiatočné km × 0.65)` bez DPH.
- Výjazdy: `ceil(človekohodiny / montéri / 8)`. Predvolený počet montérov je 2 a je opraviteľný. Ak položky nie sú v čh, človekohodiny musí doplniť používateľ; plocha sama neurčuje čas práce.
- 48 čh / 2 montéri = 3 výjazdy; Rajec 30 €. Mimo Rajca 20 km × 2 výjazdy = 50 €, 60 km × 2 = 78 €, 100 km × 3 = 195 €.
- DPH pridáva existujúci mechanizmus ponuky. Náklad dopravy je null, zisk preto nie je overený.

## Použitie

Po vložení novej zostavy alebo uložení jednoduchej podlahovky sa vytvorí jedna položka Doprava a automaticky začne výpočet trasy. Panel Doprava je aj v jednoduchom editore. Úplná adresa sa mení cez Upraviť kontakt; odlišná adresa realizácie má samostatné pole. Trasa sa počíta po 650 ms, výsledky sa cachujú 24 hodín v pamäti. Adresy sa neukladajú do lokálneho trvalého cache.

Doplňte čh a počet montérov, ak zostava nemá prácu v čh. Ručne môžete zmeniť spiatočné km a celé výjazdy. Pri nedostupnosti API po zadaní km aplikácia vyžiada presnú obec a prípadne výjazdy. Ručný cenový override zostáva zachovaný. Tlačidlo Obnoviť automatické km a výjazdy ruší len tieto korekcie, nie ručnú cenu. Chyba routovania nikdy nenastavuje nulové kilometre. Výslovných 0 výjazdov znamená žiadnu dopravu; pri pozitívnom výjazde mimo Rajca platí minimum aj pri ručne zadanej nule km.

Schválené/vydané ponuky sa automaticky neprepočítajú. Otvorenie starých kilometrových riadkov ich nemigruje. Zmena ich dopravy je výslovná korekcia, ktorá zachová ručný celkový predaj. Ak montáž obsahuje dopravu, samostatný riadok sa nepridáva. Zápisy používajú existujúci outbox a zámky; firemný sadzobník naďalej používa existujúcu CAS revision synchronizáciu.

Kým chýba trasa alebo výjazdy, nový riadok má nenacenenú cenu (null); PDF sa nesmie vydávať ako kompletne nacenené. Existujúci cenový override pri zmene adresy neprepíše automatika. Staré `transport_price`/`transport_cost` sú legacy paušály a nejde o sadzbu €/km. Nová doprava používa schválené fixné spoločné pravidlá; podlahový cenník dopravy sa v aplikácii už nepoužíva.

## Server a aktivácia

`supabase/functions/transport-route/index.ts` je Supabase Edge Function `transport-route` s `verify_jwt=true`. Navyše overuje používateľa cez Auth a aktívny záznam `app_users` pod jeho RLS. Volá iba pevné HTTPS domény openrouteservice. Kľúč nesmie byť v konfigurácii prehliadača ani GitHube.

Pred aktiváciou nastavte v Supabase Dashboard → Edge Functions → Secrets serverové tajomstvo `ORS_API_KEY` z účtu openrouteservice. Bez kľúča funkcia vráti 503 a editor ponúkne manuálnu korekciu. Potom nasaďte funkciu a overte živú adresu v prihlásenej aplikácii. Poskytovateľovi sa odošle iba adresa realizácie a východiska, nie meno či telefón zákazníka.

Geokódovanie požaduje konkrétnu adresu s číslom, ulicou a obcou a dostatočnou confidence. Podobné viaceré kandidáty odmieta. Cestná trasa tam a späť sú dve samostatné požiadavky; nesymetrické smery sa sčítajú. Každá požiadavka má časový limit 10 s. Backend má obmedzenú pamäťovú cache a limit 10 požiadaviek/minútu/používateľa/worker. Tento limit je ochrana workeru, nie globálny limit medzi všetkými inštanciami; nastavte tiež kvótu poskytovateľa pre serverový kľúč.

## Overenie

`node --test mobile-v4/tests/*.cjs` (Node 22.6+). Testy zahŕňajú hranice sadzby, spiatočné nesymetrické trasy, čh, ručné korekcie a ceny, staré ponuky, zahrnutú dopravu, podlahovku, nulové/chybné API výsledky, cache, chýbajúci kľúč a oneskorené odpovede pri zmene adresy/ponuky/rozsahu. Živé routovanie vyžaduje nakonfigurovaný poskytovateľský kľúč.
