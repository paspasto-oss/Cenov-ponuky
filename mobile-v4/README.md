# Spektra Ponuky v4 – hlavná aplikácia

Funkčný MVP sprievodca pre predajňu a terén.

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
Ponuky sú v tejto fáze uložené lokálne v prehliadači.
Schéma pre spoločnú databázu je pripravená v `database/`.
