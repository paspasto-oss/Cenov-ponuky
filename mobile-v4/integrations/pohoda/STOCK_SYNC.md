# Týždenná synchronizácia zásob POHODA -> Spektra Ponuky

## Cieľ

Katalóg zariadení a materiálu v aplikácii sa nesmie plniť ručne ako oddelený cenník.
POHODA je hlavný zdroj skladových kariet, cien a skladového množstva.

Aplikácia musí vedieť:
- doplniť nové produkty,
- aktualizovať názov, MJ, sklad, skupinu, dodávateľa a výrobcu,
- aktualizovať nákupnú a predajnú cenu,
- aktualizovať stav zásoby,
- označiť zrušené / chýbajúce produkty ako neaktívne,
- zachovať staré ceny na už vytvorených ponukách,
- ukázať používateľovi prehľad zmien pred aplikovaním synchronizácie.

## Dva režimy synchronizácie

### A. Produkčný režim – POHODA mServer / XML

Preferovaný spôsob.

POHODA mServer podporuje XML export zásob cez `listStockRequest`.
Bridge bežiaci na PC so sieťovým prístupom k POHODE raz týždenne:
1. požiada mServer o úplný export zásob,
2. uloží odpoveď do staging tabuľky,
3. vypočíta rozdiel oproti poslednému úspešnému syncu,
4. aplikuje zmeny do `pohoda_stocks`,
5. uloží históriu cien a výsledok synchronizácie.

Dôležité: ako stabilný identifikátor zásoby používame interné ID exportované POHODOU.
Kód, PLU ani názov nesmú byť jediným identifikátorom.

### B. Záložný režim – nahratie XLSX exportu Zásoby

Pokiaľ mServer ešte nebude pripojený, v administrácii bude:
**Sklad -> Aktualizovať z POHODY -> Nahrať Zásoby.xlsx**

Postup:
1. používateľ vyexportuje aktuálnu tabuľku Zásoby z POHODY,
2. nahrá XLSX,
3. aplikácia načíta údaje do stagingu,
4. zobrazí:
   - nové produkty,
   - zmenené ceny,
   - zmenené množstvá,
   - zmenené názvy / metadata,
   - produkty, ktoré už v novom exporte nie sú,
   - konfliktné / duplicitné riadky,
5. používateľ stlačí **Použiť aktualizáciu**.

XLSX je fallback. Dlhodobo má byť hlavný sync cez XML/mServer, pretože XML poskytuje spoľahlivejšiu identitu skladovej karty.

## Mapovanie aktuálneho XLSX exportu

Podporované hlavičky:

| POHODA XLSX | Aplikácia |
| --- | --- |
| PLU | plu |
| Názov | name |
| Mj | unit |
| Predajná DPH | sell_price_inc_vat |
| Nákupná | purchase_price_ex_vat |
| Predajná | sell_price_ex_vat |
| Stav zásoby | quantity_available |
| Minlimit | min_limit |
| Maxlimit | max_limit |
| Objednať | quantity_to_order |
| Kód | code |
| Čiarkód | ean |
| Marža | margin_pct |
| Rabat | discount_pct |
| RefSkSkup | stock_group_ref |
| Skupina | stock_group |
| RefSklad | storage_ref |
| Sklad | storage_name |
| Dodávateľ | supplier_name |
| Výrobca | manufacturer |
| Vytvorené | pohoda_created_at |
| Labels / Štítky | labels |

## Identita pri XLSX fallbacku

Aktuálny tabuľkový export nemusí mať spoľahlivé jednoznačné ID. Preto:
1. ak je už známe `pohoda_stock_id` z XML, používa sa vždy,
2. inak sa vytvorí dočasný fingerprint z normalizovaných polí:
   `PLU + Kód + RefSklad/Sklad + Názov`,
3. rovnaké fingerprinty v jednom XLSX sa zlúčia a dodávatelia sa evidujú oddelene,
4. ak majú zhodný fingerprint ale rozdielne ceny/množstvá, sync sa označí ako konflikt a vyžaduje kontrolu,
5. pri podozrení na premenovanie zásoby sa stará karta automaticky nemaže.

## Čo sa deje pri zmene ceny

Pri každom úspešnom syncu:
- `pohoda_stocks.purchase_price_ex_vat` a `sell_price_ex_vat` dostanú nové aktuálne ceny,
- pôvodná cena sa uloží do `pohoda_stock_price_history`,
- už uložená cenová ponuka sa NEPREPOČÍTA.

Ponuka má vlastný price snapshot. Novú cenu dostane až nová ponuka alebo používateľ vedome stlačí **Prepočítať podľa aktuálneho cenníka**.

## Čo sa deje s novým produktom

Nový produkt zo syncu:
- sa založí v `pohoda_stocks`,
- je dostupný vo vyhľadávaní katalógu,
- do automatických montážnych balíkov sa nezaradí sám.

Pre balíky split/monoblok/klíma musí byť produkt explicitne namapovaný na rolu v `bundle_recipe_items`.

## Čo sa deje s odstráneným produktom

Produkt, ktorý bol v predchádzajúcom úplnom exporte a v novom už nie je:
- sa fyzicky nezmaže,
- nastaví sa `active=false` a `missing_since`,
- staré ponuky a doklady ho naďalej poznajú,
- nové ponuky ho nebudú ponúkať.

## Týždenný režim

Minimálny režim:
- 1× týždenne úplný sync katalógu + cien + skladového stavu,
- tlačidlo **Synchronizovať teraz** kedykoľvek.

Odporúčanie do budúcna:
- úplný katalóg/ceny 1× týždenne,
- stav skladu je možné obnovovať častejšie alebo tesne pred tvorbou Výdajky / Vydanej objednávky.

## Kontrola syncu

Administrácia zobrazí:
- posledná úspešná synchronizácia,
- zdroj: mServer / XLSX,
- počet načítaných riadkov,
- nové produkty,
- zmenené ceny,
- zmenené skladové množstvo,
- deaktivované produkty,
- konflikty,
- chyby.

Synchronizácia sa nikdy nesmie aplikovať čiastočne bez záznamu o výsledku.
