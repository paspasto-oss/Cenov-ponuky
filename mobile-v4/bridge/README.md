# POHODA Sync Bridge

Bridge bude bežať na Windows PC, ktorý má prístup k POHODE / mServeru.

## Režimy
1. `mServer XML` – automatický produkčný sync.
2. `XLSX upload` – dočasný fallback.

## Týždenná úloha
Odporúčané spustenie napr. pondelok 05:00:
- full stock export,
- normalize,
- diff,
- apply,
- log result.

Presný čas bude konfigurovateľný. V aplikácii bude aj ručné tlačidlo Synchronizovať teraz.

## Dôležité
Mobil a tablet sa nepripájajú priamo na POHODU.
Komunikáciu robí bridge a cloud databáza.
