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
