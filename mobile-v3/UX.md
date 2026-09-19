# Spektra Ponuky – terén / predajňa UX

Cieľ: jedna aplikácia pre technika v teréne aj Martinu na predajni.

## Zásada
Používateľ nemá začínať tabuľkou položiek. Najprv zadá zákazníka a potrebu. Cenu a položky rieši aplikácia až v ďalšom kroku.

## Dva hlavné vstupy

### 1. Rýchly dopyt
Určené najmä pre predajňu a telefonické dopyty. Vyplnenie do 60 sekúnd.

Povinné:
- meno / firma,
- telefón alebo e-mail,
- čo zákazník potrebuje.

Voliteľné:
- obec / adresa realizácie,
- poznámka,
- preferovaný termín.

Typ dopytu:
- tepelné čerpadlo,
- klimatizácia,
- kotol,
- ZTI,
- servis,
- iné.

Po uložení vznikne stav **DOPYT**. Technik ho môže neskôr otvoriť cez **Dokončiť ponuku**.

### 2. Nová cenová ponuka
Určené pre situácie, keď sú technické údaje známe.

Kroky:
1. Zákazník
2. Typ zákazky
3. Zariadenie
4. Doplnky a montáž
5. Cena
6. Odoslanie

## Zákazník
Minimálne polia:
- meno / firma,
- telefón,
- e-mail,
- adresa realizácie.

Aplikácia nesmie nútiť vypĺňať IČO, DIČ a podobné údaje pri prvom kontakte. Tie sa zobrazia až po voľbe "Firemný zákazník".

## Zariadenie
Výber:
Kategória -> Značka -> Model -> Výkon.

Po naplnení cenníka sa automaticky doplní:
- predajná cena,
- nákupná cena (len interne),
- rabat,
- marža,
- štandardné príslušenstvo.

## Terénny režim
Na mobile:
- veľké dotykové tlačidlá,
- minimum písania,
- výber cez karty a čipy,
- automatické ukladanie rozpracovanej ponuky,
- tlačidlo Zavolať zákazníkovi,
- tlačidlo WhatsApp,
- možnosť dopísať poznámku hlasovým diktovaním cez klávesnicu telefónu.

## Predajňa
Na tablete/PC:
- rovnaký postup,
- širšie dvojstĺpcové rozloženie,
- posledné dopyty a ponuky na úvodnej obrazovke,
- filtrovanie podľa stavu.

## Stavy
- Dopyt
- Rozpracovaná
- Pripravená
- Odoslaná
- Schválená
- Zamietnutá

## Odoslanie
Na konci musí byť jedno výrazné tlačidlo **Odoslať zákazníkovi**.

Kanály:
- PDF,
- e-mail,
- WhatsApp,
- systémové Zdieľať na mobile.

V MVP je možné poslať textový súhrn cez WhatsApp/e-mail a PDF vytlačiť/uložiť. Pre skutočné odoslanie PDF jedným klikom bude potrebný backend alebo e-mailová služba.

## Automatické uloženie
Každá zmena formulára sa priebežne uloží. Pri zatvorení mobilu alebo tabletu sa rozpracovaná ponuka nesmie stratiť.

## Priorita pred cenami
Pred plnením cenníkov dokončiť tento pracovný tok. Potom napojíme device-catalog.json a ceny sa budú dopĺňať automaticky.
