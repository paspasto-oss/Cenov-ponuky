# POHODA ako zdroj pravdy pre ponuky a sklad

## Základné pravidlo

Zákaznícka ponuka môže byť vizuálne zjednodušená, ale **na pozadí musí byť každá skladová a montážna položka naviazaná na konkrétnu zásobu v POHODE**.

To znamená, že aplikácia nebude mať druhý nezávislý cenník, ktorý sa časom rozíde s POHODOU. POHODA je master pre:
- kód zásoby,
- názov,
- sklad,
- MJ,
- DPH,
- nákupnú cenu,
- predajnú cenu,
- stav skladu,
- dodávateľa, ak je k dispozícii.

Aplikácia si tieto údaje synchronizuje do vlastnej databázy a pri vytvorení ponuky uloží cenový snapshot.

## Dve vrstvy jednej ponuky

### 1. Zákaznícka vrstva
V PDF zákazník uvidí napríklad:
- Midea Nature 12 kW
- Hydraulické a montážne príslušenstvo do 5 m
- Montáž a uvedenie do prevádzky
- Cena spolu

### 2. Interná skladová vrstva
Na pozadí zostane presný BOM:
- konkrétne TČ s kódom zásoby POHODA,
- filter,
- odlučovač vzduchu,
- poistný ventil,
- expanzná nádoba,
- guľové ventily,
- potrubie,
- izolácia,
- káble,
- ističe,
- chrániče,
- montážna práca ako vlastná položka POHODA,
- ďalšie komponenty podľa split / monoblok / klimatizácia.

Každý interný riadok má:
- `pohoda_stock_id`
- `pohoda_code`
- `pohoda_storage_id` / názov skladu
- `unit`
- `qty`
- `purchase_price_ex_vat_snapshot`
- `sell_price_ex_vat_snapshot`
- `vat_pct_snapshot`

Bez POHODA väzby sa položka nesmie automaticky odpisovať zo skladu. Taká položka sa označí ako `unmapped` a ponuka sa pred exportom musí opraviť.

## Tok dát

### Synchronizácia POHODA -> aplikácia
1. POHODA exportuje zásoby cez XML / mServer.
2. Backend ich uloží do tabuľky `pohoda_stocks`.
3. Aplikácia používa synchronizované zásoby pri výbere zariadení a pri skladaní montážnych balíkov.
4. Zmeny nákupných/predajných cien sa prejavia pri novej ponuke; stará ponuka si ponechá snapshot ceny.

### Ponuka -> POHODA
Z jednej schválenej ponuky bude možné vytvoriť exportný doklad:
- **Vydaná ponuka** – evidencia ponuky v POHODE.
- **Prijatá objednávka** – keď zákazník ponuku odsúhlasí; z pohľadu Spektry ide o objednávku prijatú od zákazníka.
- **Výdajka** – skutočne vydaný materiál na zákazku.
- **Vydaná objednávka** – nákup chýbajúcich položiek u dodávateľa.
- **Príjemka** – príjem dodaného materiálu; ideálne s väzbou na vydanú objednávku.
- neskôr Vydaná faktúra.

Dôležité: Vydaná objednávka v POHODE je nákupný doklad smerom k dodávateľovi. Pre objednávku zákazníka používame Prijatú objednávku.

## Nedostatok na sklade

Pri schválení ponuky sa vypočíta:
`potreba - dostupné množstvo = chýbajúce množstvo`

Chýbajúce skladové položky sa zoskupia podľa dodávateľa. Aplikácia potom pripraví jednu alebo viac Vydaných objednávok do POHODY.

Po dodaní materiálu môže vzniknúť Príjemka s väzbou na vydanú objednávku.

## Výdaj materiálu

Výdajka sa nevytvorí už pri cenovej ponuke. Vytvorí sa až:
- pri vyskladnení na zákazku,
- pri začatí montáže,
- alebo manuálne tlačidlom "Vytvoriť výdajku".

Aplikácia umožní pred výdajom upraviť reálne množstvo. Rozdiel oproti kalkulácii ostane v histórii zákazky.

## Montážne balíky

Balík "Monoblok do 5 m" alebo "Split do 5 m" nie je jedna virtuálna skladová položka.

Je to recept/BOM, ktorého každý komponent smeruje na zásobu POHODA.

Príklad:
`hp_monoblock_5m -> [FILTER_MAG, EXP25, BALL_1, PIPE_28, INS_28, ...]`

Používateľ vidí jednu zákaznícku skupinu, sklad dostane jednotlivé zásoby.

## Práca a služby

Aj montáž, demontáž, doprava, spustenie a jadrové vŕtanie budú mať vlastné kódy v POHODE. Nemusia meniť fyzický stav skladu, ale v dokladoch budú mať konzistentný kód a cenu.

## Prevádzková architektúra

Mobil/tablet sa nebude pripájať priamo na databázu POHODY.

Odporúčaný tok:
- cloud databáza aplikácie,
- synchronizačný bridge na PC, kde beží POHODA,
- bridge komunikuje s POHODA mServer/XML,
- aplikácia vytvára `pohoda_export_jobs`,
- bridge ich odošle do POHODY a uloží výsledok `responsePack`.

Takto môže Martina pracovať na predajni a technik v teréne, aj keď POHODA nie je priamo dostupná z internetu.

## Kontroly pred exportom

Export do POHODY sa zablokuje, ak:
- skladová položka nemá POHODA väzbu,
- chýba MJ,
- nie je známy sklad,
- množstvo je nulové alebo záporné tam, kde nemá byť,
- položka bola od poslednej synchronizácie v POHODE zmazaná/deaktivovaná.

Aplikácia zobrazí presný zoznam problémových položiek.
