# HVAC editor cenových ponúk

Verzia aplikácie: `20261007-hvac1`.

## Použitie

1. V novej ponuke vyplňte zákazníka a zvoľte **Rýchla ponuka zo scenára**.
2. Na karte **Zostavy** vyberte scenár, konkrétne zariadenie z katalógu a rozsah.
3. **Pripraviť zostavu** zobrazí materiál, montáž, množstvá a chýbajúce ceny.
4. Po vložení upravujte kartu **Položky**. Meniť možno názov, množstvo, MJ,
   predajnú cenu a náklad. Katalógová identita sa pri premenovaní zachová.
5. Doplňte dopravu, revíziu, tlakovú skúšku, vlastnú službu alebo text.
6. Na karte **Náhľad** zvoľte samostatne výstup materiálu a montáže, prípadne
   rozpis v prílohe. Tlačidlo **PDF / Tlač** pripraví zákaznícky dokument.

Existujúca vydaná ponuka zostáva zachovaná. Jej prvá platná úprava vytvorí
nový koncept s označením R2, prípadne ďalším číslom revízie. Schválená ponuka
sa otvára vo finálnom zobrazení; tlačidlo úpravy vytvorí revíziu.
Dokončenie alebo priama tvorba PDF uloží kompletný koncept ako `ready`
pred renderovaním. Opakovaná tlač už vydanej ponuky nevytvára novú revíziu.

## Scenáre

| Scenár | Vstupy a rozsah |
|---|---|
| Tepelné čerpadlo | Zvolené zariadenie, monoblok/split, trasa, riešenie TÚV, káble, montážny variant; pri externej TÚV konkrétny zásobník |
| Plynový kotol | Zvolené zariadenie, materiál existujúcej receptúry, dĺžka odvodu spalín a montáž |
| Biomasa | Zvolené zariadenie, pripojovacie potrubie, príslušenstvo a montáž podľa receptúry |
| Klimatizácia monosplit | Zvolený komplet, výkon, trasa a materiál nad prvé 3 m zahrnuté v pôvodnej montážnej cene |
| Klimatizácia multisplit | Vonkajšia jednotka, konkrétne vnútorné jednotky, výkon a dĺžka každej vetvy |
| ZTI | Počty jednotlivých vývodov a prvkov, dĺžky potrubí 16/20/25, novostavba/rekonštrukcia a montážna sadzba |

Používajú sa existujúce `bundle-recipes.json` a doterajšie normy ZTI.
Scenár nie je automatický technický návrh pre ľubovoľnú kombináciu zariadení.
Neznáme ceny ostávajú nevyplnené; kompatibilitu a rozsah treba overiť podľa
zvoleného zariadenia a konkrétnej realizácie.

## Skupiny, pravidlá a tlač

Účtované riadky sú vždy iba v `quote.items`. Hlavičky skupín, uložené varianty
ani nevybrané doplnky sa do ceny nepripočítavajú.

- **Súčet položiek** používa skutočné riadkové množstvá a ceny.
- **Pevná cena** má jeden účtovaný riadok. Jej úkony/obsah sú opisné, pokiaľ
  sa jednotlivé práce neocenia ako samostatné riadky. Aplikácia nerozdeľuje
  paušál medzi úkony vymysleným pomerom.
- Materiál aj montáž majú vlastný režim **Jedna položka / Obsah bez cien
  riadkov / Úplný rozpis s cenami**. Príloha presunie rozpis za súhrnnú ponuku.
- Zmena výstupu nemení zákaznícky súčet. Interné náklady a marže sa do
  zákazníckeho dokumentu neprenášajú.
- **Prepočítať množstvá** pracuje s uloženými parametrami a ukáže rozdiely.
  **Aktualizovať ceny** je samostatná akcia s vlastným náhľadom.
- Ručné množstvá a ceny ostávajú chránené, kým používateľ nezvolí ich prepočet.
- Každý vložený scenár má vlastný priestor parametrov; zmena trasy jedného
  scenára nemení iný scenár v tej istej ponuke.

Detail riadku umožňuje prideliť skupinu, pravidlo množstva a cenové pravidlo.
Pôvodné vážené množstevné pravidlá ZTI možno zachovať. Nový typ komponentu,
ktorý pôvodne nebol zahrnutý, sa doplní ďalším scenárom alebo riadkom.

## Cenový štandard a knižnica

**Cenový štandard** ukladá spôsob ocenenia materiálu, hodinový predaj/náklad
práce, dopravu a hranicu upozornenia na maržu. Podporuje katalógovú cenu,
prirážku k nákladu alebo požadovanú maržu. Prirážka a marža majú odlišný
výpočet. Nevyplnený náklad sa nepovažuje za nulu.

Zmena firemného štandardu sama neprepisuje existujúce ponuky. Pri novej
zostave sa použije iba na práve vložené riadky. Pevné ceny a osobitné
riadkové pravidlá zostávajú zachované. Použitie na existujúcu ponuku má náhľad.

Skupinu možno uložiť ako opakovateľnú zostavu bez údajov zákazníka. V knižnici
sa dá meniť jej názov, stav overenia, množstvá, MJ a ceny, uložiť kópia alebo
importovať/exportovať JSON. Nová verzia šablóny nemení staršie ponuky.
Pri vkladaní možno zadať počet zostáv. Pri pevnom materiálovom balíku sa
násobí aj číselný rozpis pre nákup; čisto opisným úkonom sa množstvo nedopĺňa.

Importovaná zostava s vlastnými parametrickými pravidlami sa vkladá s počtom 1
a upraví sa jej príslušný parameter. Aplikácia odmietne nejednoznačné čiastočné
násobenie takého balíka.

Zostavy a sadzobník sa synchronizujú medzi aktívnymi používateľmi Spektra.
Súbežné uloženie kontroluje číslo verzie. Pri konflikte zostáva lokálna úprava
zachovaná; **Skontrolovať uloženie** umožní porovnať aktuálnu spoločnú verziu,
prevziať ju alebo vedome uložiť vlastnú úpravu ako ďalšiu verziu.

## Varianty a podklady realizácie

**Uložiť variant** uchová aktuálne položky a konfiguráciu. Pri prepnutí variantu
sa zachovajú posledné úpravy predchádzajúceho variantu. V cene ponuky je iba
zvolený variant; jeho názov sa uvádza aj v PDF. Nevybraný voliteľný doplnok
nie je účtovaný. Budúci ročný servis zostáva mimo úvodnej ceny realizácie.

- **Nákupný zoznam** spája rovnakú katalógovú kartu a MJ, zachováva zdrojové
  skupiny a upozorňuje na nemapované či neúplné balíky.
- **Podklad pre montáž** uvádza zariadenia, práce, rozsah a interné poznámky.
- **Skutočné náklady** ukladajú materiál, hodiny, prácu, dopravu a poznámku
  k realizácii oddelene od obchodnej ponuky. Nemenia vydanú cenu.

Oba interné podklady možno prezerať a stiahnuť ako tlačiteľné HTML.

### Konkrétne obmedzenie monosplitu

Pôvodná pevná montážna cena obsahuje prvé 3 m trasy, ale existujúce dáta
neobsahujú ich úplný rozpis katalógových kariet. Tento balík je preto označený
ako neúplný pre nákup. Samostatný nadlimitný materiál sa vypočítava; chýbajúce
karty základného balíka treba doplniť pri overení firemnej zostavy.

## Ukladanie a technické overenie

- `quote-assemblies.js`: nezávislý model zostáv, pravidiel, revízií a variantov.
- `hvac-scenarios.js`: šesť scenárov, existujúce receptúry, šablóny a import.
- `quote-workbench.js` + CSS: ovládanie; mutácie idú cez existujúci outbox.
- `quote-row-output.js` + `quote-workbench-output.js`: zákaznícke a interné
  výstupy so spoločným kanonickým výpočtom a existujúcim zaokrúhľovaním.
- `material_edits.assemblies` v quote workflow: skupiny, výstup, parametre,
  scenáre, varianty, doplnky a pôvod revízie.
- `stored_metadata.quote_assembly`: stabilná identita, katalógová väzba,
  skupina, ručné úpravy a pravidlá riadku.
- `quote_library`: spoločná knižnica, firemné ceny a spätná väzba realizácie.
  RLS vyžaduje aktívny `app_users` účet. Aktualizácia vyžaduje očakávanú verziu.
- Migrácia `20261007195932_quote_library.sql` je aditívna a nemení staré ponuky.

Regresné kontroly:

```bash
node --test mobile-v4/tests/*.cjs
```

Testy overujú pôvodný štart aplikácie, uloženie, všetkých šesť scenárov,
ručné úpravy, revízie, rovnaký súčet vo výstupných kombináciách, neúnik
interných údajov, nákup, násobenie balíkov, konflikty a oneskorené odpovede.
Pri tejto verzii prešla aj skúška skutočného DOM v jsdom a SQL roundtrip cez
`save_quote_atomic` i `quote_library`; databázové skúšky sa skončili rollbackom.
