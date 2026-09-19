# Monoblok do 5 m – mapovanie POHODA v1

Zdroj: aktuálny export `Zásoby(2).xlsx`.

## Namapované položky
- Magnetický filter: `TOTAL FILTER TF1-1`
- Poistný ventil ÚK 2,5 bar: `150039533709300003`
- Expanzná nádoba ÚK: `IMERA R24` (24 l ako najbližšia skladová karta k štandardu ~25 l)
- Servisný ventil expanznej nádoby: `1220502`
- Automatický prepúšťací ventil: `1400432`
- Guľový ventil 1": `154079591609750002` (default 6 ks)
- Cu DN28x1: `138023023208850005`, 10 m pri trase do 5 m
- Izolácia 13x28: `146026005900650034`, 10 m pri trase do 5 m
- Hydraulický separátor DN25: `606001` – štandardne zapnutý, technik môže vypnúť
- TÚV expanzka 8 l: `NP.CWU.08.IB` – iba pri externom zásobníku
- TÚV poistný ventil 8 bar: `417502` – iba pri externom zásobníku

## Ešte treba rozhodnúť / doplniť
1. **Odlučovač vzduchu 1"** – v exporte je iba DISCAL 3/4" (`INT_CLF 551005`), preto ho nechcem automaticky nasadiť na všetky TČ.
2. **Obehové čerpadlo** – kandidáti OHI PRO 25-60/180 a Grundfos ALPHA1 25-60. Treba zvoliť firemný štandard.
3. **Ochrana proti zamrznutiu** – musí byť modelovo/hydraulicky závislá. Glykol sa nemôže vložiť ako pevné univerzálne množstvo.
4. **UV ochrana vonkajšej izolácie** – doplniť skladovú kartu.
5. **Prúdový chránič** – v aktuálnom exporte sa nenašla jednoznačná karta.
6. **Jadrové vŕtanie** – vytvoriť v POHODE službu.
7. **Montáž TČ do 5 m** – vytvoriť v POHODE službu; v aplikácii zostáva predvolená cena 600 € bez DPH.
8. **Elektro** – kábel/istič/ochrana sa bude vyberať podľa konkrétneho modelu a počtu fáz, nie univerzálne.

## Pravidlo trasy
Pri zadaní `route_m = 5` sa Cu D28 a izolácia počítajú `2 × route_m`, teda 10 m (prívod + spiatočka).

## Dôležité
Zákazník tieto riadky nemusí vidieť jednotlivo. PDF ich môže zoskupiť ako:
**Hydraulické a montážne príslušenstvo do 5 m**.

POHODA/Výdajka však dostane jednotlivé skladové karty a reálne množstvá.


## Rozšírenie firemného štandardu

Na základe aktuálneho montážneho štandardu boli pridané:

- Obehové čerpadlo OHI PRO 25-60/180: `115907`, PLU `103223`, 1 ks
- Skrutkovanie k čerpadlu 1"x6/4" so vstavaným guľovým kohútikom: `110810001`, PLU `108196`, 2 ks
- Prechodová vsuvka 28x1": `124243G281`, PLU `101284`, 8 ks
- Cu koleno 28 mm 90°: `5090 028000000`, PLU `103740`, 14 ks
- Mosadzné šróbenie 1": `5061001`, PLU `104102`, 6 ks
- Mosadzné šróbenie 3/4": `50610034`, PLU `104091`, 4 ks pri externom zásobníku TÚV
- AOV 1/2": `330030`, 2 ks
- Vypúšťací ventil 1/2": `46450012`, PLU `102398`, 2 ks
- Vsuvka 1": `06458006`, PLU `108449`, 14 ks
- T-kus 1" x 3/4" x 1": `06413104`, PLU `108375`, 12 ks
- T-kus 3/4" x 1/2" x 3/4": `06413102`, PLU `108373`, 4 ks pri TÚV
- MERABELL READY! G1/2"-G1/2", 0,8 m: `M0414`, PLU `250018`, 2 ks

V hlavnom sprievodcovi pribudla voľba **externý zásobník TÚV / bez externého zásobníka**. TÚV šróbenia a redukované T-kusy sa vložia len pri externom zásobníku.
