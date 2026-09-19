# Spektra Ponuky v4 – cieľový pracovný tok

Táto verzia je navrhnutá tak, aby ju vedela používať Martina na predajni bez znalosti cien a technických detailov a zároveň technik v teréne.

## 1. Čo zadáva Martina / technik
Zákazník:
- meno / firma
- telefón
- e-mail
- adresa realizácie

Budova:
- buď známa tepelná strata v kW,
- alebo plocha budovy v m² + stav budovy,
- typ vykurovania: podlahovka / radiátory / vysokoteplotné radiátory,
- voliteľná poznámka.

Výber:
- tepelné čerpadlo / klimatizácia / kotol,
- značka.

Martina nemusí vyberať konkrétny model, výkon, príslušenstvo ani cenu.

## 2. Čo urobí aplikácia na pozadí
### Tepelné čerpadlo
Ak je zadaná tepelná strata, použije sa priamo.
Ak nie je, vypočíta sa orientačný návrhový výkon z plochy a triedy budovy.

Použitá metodika:
- 45 W/m² – novostavba / veľmi dobre zateplený dom
- 60 W/m² – zateplený dom
- 95 W/m² – starší dom / slabšie zateplený
- 125 W/m² – nezateplený / vysoká strata
- rezerva +10 % podlahovka
- rezerva +15 % radiátory
- rezerva +20 % vysokoteplotné radiátory / horské podmienky

Následne sa vyberie najbližší vhodný výkon 5 / 7 / 9 / 12 / 16 kW.

Podľa značky sa z cenníka nájde vhodné zariadenie.

### Typ systému
Presný model v katalógu musí mať príznak split / monoblok.
Podľa neho aplikácia automaticky pridá správny balík montážneho materiálu do 5 m.

### Materiál
Zákazník v PDF nemusí vidieť každú objímku, ventil alebo kábel.
PDF zobrazí napr.:
- tepelné čerpadlo,
- montážny materiál a hydraulické príslušenstvo do 5 m,
- montáž a uvedenie do prevádzky,
- voliteľné doplnky.

Interná kalkulácia zostane položkovitá.

## 3. Klimatizácia
Martina zadá:
- miestnosť / objekt,
- približnú plochu,
- počet vnútorných jednotiek,
- značku.

Aplikácia vyberie výkon/model z katalógu a automaticky pripojí montážny balík do 5 m.

Pre single-split máme pripravený základný 5 m materiálový balík. Presná predajná cena montáže bude samostatná položka cenníka.

## 4. Výsledok
Pred odoslaním sa zobrazí:
- odporučené zariadenie,
- výkon,
- cena zariadenia,
- štandardná montáž,
- doplnky,
- celková cena s DPH.

Používateľ môže ponuku pred odoslaním upraviť.

## 5. PDF a zdieľanie
Výstup:
- zákaznícke PDF bez nákupných cien a interných marží,
- systémové "Zdieľať" na Android/iOS,
- WhatsApp / e-mail podľa možností zariadenia.

## 6. Databáza
localStorage nie je dostatočný pre ostrú prevádzku, pretože Martina a technik musia vidieť rovnaké ponuky na rôznych zariadeniach.

Produkčná verzia potrebuje spoločnú databázu:
- customers
- quotes
- quote_items
- quote_events
- app_users

Ponuku bude možné:
- uložiť,
- otvoriť na inom zariadení,
- upraviť,
- duplikovať,
- znovu vygenerovať PDF,
- evidovať stav Dopyt / Rozpracovaná / Odoslaná / Schválená / Zamietnutá.

V repozitári je pripravená SQL schéma pre Supabase/PostgreSQL. Pripojenie databázy je samostatný krok, pretože vyžaduje URL projektu a verejný anon kľúč.
