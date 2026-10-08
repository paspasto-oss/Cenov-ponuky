# Zásoby POHODA a riadky zostáv

## Postup v aplikácii

1. Pripravte zostavu a vložte ju do ponuky. Nespárovaný materiál zostáva so sivým názvom ako zástupný riadok a s prázdnou cenou.
2. V záložke **Položky** stlačte pri riadku **Zásoby**. Vyhľadajte kód alebo názov a vyberte konkrétnu skladovú kartu.
3. Skontrolujte kód, nákup, predaj, množstvo a MJ a potvrďte **Priradiť do tohto riadku**. Nevytvorí sa ďalší riadok. Pri zmene MJ je povinné potvrdiť prepočet množstva.
4. Chýbajúcu kartu vytvorte v POHODE a importujte XML cez odkaz v dialógu. Potom stlačte **Obnoviť zásoby** a kartu vyberte. Samotný import nemení ponuku.
5. Spárovanú skupinu uložte cez **Uložiť ako zostavu**. Pri ďalšom vložení z **Mojich zostáv** sa načítajú aktuálne ceny podľa uloženého kódu. Súhrnná skupina materiálu a montáž sa ukladajú samostatne.

## Identita a ochrana údajov

- Kód je text: úvodné nuly, veľkosť písmen a vnútorné medzery sa zachovávajú. Názov a PLU nikdy nenahrádzajú iný kód.
- Jedinečný kód zostáva rovnakou kartou aj po zmene názvu alebo členenia. Pri viacerých kartách rovnakého kódu sa rozlišuje sklad; nejednoznačnosť je konflikt, nie automatický výber.
- Úplný import s konfliktmi sa nepoužije. Čiastočný import vynechá konfliktné riadky. Rozdielne ceny/MJ/množstvá pri duplicitnom kóde a sklade sa nevyberajú podľa skóre.
- Nové explicitné prepojenia ukladajú `catalog_ref.match_by = "code"`. Staršie ID prepojenia sa spätne nemenia; používateľ ich môže prepojiť cez **Zásoby**. Tak sa neprepojí historický doklad na inú kartu bez kontroly.
- Uložené ponuky sa pri importe nemenia. Aktualizácia cien je samostatný potvrdený úkon. Úprava vydanej ponuky vytvorí novú revíziu; schválený originál zostáva zachovaný.
- Chýbajúca karta alebo zmenená MJ v novej inštancii uloženej zostavy nesmie prevziať starú cenu. Používateľ ju musí znovu priradiť.
- Importované doplnkové XML polia a pôvodné stĺpce XLSX sa ukladajú aj v existujúcom `raw_payload` JSON poli; nevytvárajú sa nové databázové stĺpce. XML obrázky sa naďalej spracúvajú samostatne existujúcim importérom.

## Overenie

`node --test mobile-v4/tests/*.cjs`

Regresné testy pokrývajú kód vs. PLU/názov, úvodné nuly, nejednoznačné kódy, zmenu MJ, nulové/chýbajúce ceny, import, uloženie a opätovné vloženie zostavy, náhľad pred potvrdením a ochranu vydaných ponúk.
