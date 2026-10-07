# Spektra Ponuky v4 – hlavná aplikácia

Funkčný MVP sprievodca pre predajňu a terén.

## HVAC zostavy a riadkové ponuky

Od verzie `20261007-hvac1` je dostupný aj postup **Rýchla ponuka zo scenára**.
Podporuje šesť HVAC/ZTI scenárov, opakovateľné zostavy, cenové pravidlá,
revízie vydaných ponúk, varianty, nezávislý rozpis materiálu a montáže,
nákupný zoznam a podklady realizácie.

Použitie, dátový model, overenie a známe hranice opisuje
[HVAC editor ponúk](docs/hvac-workbench.md).

## Tok
1. Zákazník
2. Dom / tepelná strata
3. Typ zariadenia a značka
4. Automatický návrh zariadenia a interného BOM
5. Cena + PDF / zdieľanie

## POHODA
Aplikácia číta lokálny baseline vytvorený cez `admin/stock-sync.html`.
Ak nájde vhodnú zásobu POHODA, použije jej predajnú a nákupnú cenu.
Interný BOM eviduje väzbu na POHODA zásobu.

## Výpočet TČ
- 45 / 60 / 95 / 125 W/m²
- rezerva +10 % podlahovka
- +15 % radiátory
- +20 % vysokoteplotné / náročné podmienky
- návrhové triedy 5 / 7 / 9 / 12 / 16 kW

## Dôležité
Automatické mapovanie montážnych komponentov na POHODA zásoby je zatiaľ heuristické.
Pred produkčným nasadením sa role v bundle-recipes.json musia explicitne namapovať na konkrétne POHODA stock ID/kódy.

## Databáza
Ponuky sa ukladajú cez Supabase RPC `save_quote_atomic`; lokálny outbox
zachováva čakajúce zmeny a kontroluje súbežné úpravy. Knižnica zostáv,
firemné cenové pravidlá a skutočné náklady používajú `quote_library`.
Prístup vyžaduje aktívny účet Spektra. Migrácie sú v `supabase/migrations/`.
